"""Provider-boundary tests use doubles, never Azure credits or real credentials."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from openai import OpenAIError

from app.model_service import ModelAnswer, ModelUnavailable, analyze_with_model
from app.schemas import AnalysisRequest


class ModelTests(unittest.TestCase):
    def setUp(self):
        from tempfile import TemporaryDirectory
        from app.catalog import initialize
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db_env = patch.dict('os.environ', {'LEMS_CATALOG_PATH': self.temp.name + '/catalog.db'})
        self.db_env.start()
        self.addCleanup(self.db_env.stop)
        initialize()
        self.payload = AnalysisRequest(ticket_id='REQ-9', equipment_id='ARD-001',
                                       problem_description='No extrusion')
        self.env = patch.dict('os.environ', {
            'MODEL_PROVIDER': 'azure',
            'AZURE_OPENAI_API_KEY': 'test-key-not-real',
            'AZURE_OPENAI_BASE_URL': 'https://test.services.ai.azure.com/openai/v1/',
            'AZURE_OPENAI_DEPLOYMENT': 'gpt-5-mini',
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        from app.catalog import documentation_context
        self.retrieval = patch('app.model_service.retrieve',
                               side_effect=lambda item, problem: documentation_context(item)).start()
        self.factory = patch('app.model_service.OpenAI').start()
        self.addCleanup(patch.stopall)
        self.parse = self.factory.return_value.__enter__.return_value.responses.parse

    def answer(self, **updates):
        data = dict(symptoms=['No extrusion'], possible_causes=[],
                    recommended_checks=['Inspect the displayed error message.'],
                    missing_information=['Error message was not provided.'])
        data.update(updates)
        self.parse.return_value = SimpleNamespace(status='completed', output_parsed=ModelAnswer(**data))

    def test_report_with_missing_information_and_request_options(self):
        self.answer()
        result = analyze_with_model(self.payload)
        self.assertEqual(result.ticket_id, 'REQ-9')
        self.assertEqual(result.result_type, 'report')
        self.assertEqual(result.missing_information, ['Error message was not provided.'])
        self.assertNotIn('questions', result.model_dump())
        kwargs = self.parse.call_args.kwargs
        self.assertNotIn('REQ-9', kwargs['input'])
        self.assertFalse(kwargs['store'])
        self.assertEqual(kwargs['max_output_tokens'], 2000)
        self.assertEqual(self.factory.call_args.kwargs['max_retries'], 0)

    def test_documentation_is_selected_by_id(self):
        import json
        self.answer()
        result = analyze_with_model(self.payload)
        sent = json.loads(self.parse.call_args.kwargs['input'])
        self.assertEqual(sent['equipment_model'], 'Arduino UNO R3')
        self.assertIn('serial port', sent['documentation'])
        self.assertEqual(result.documentation_status, 'provided')
        self.assertIn('support.arduino.cc', result.documentation_sources[0].url)

    def test_missing_documentation_has_no_sources(self):
        self.answer()
        self.payload.equipment_id = 'PC-001'
        from app.catalog import read_equipment
        item = read_equipment('PC-001')
        item['documentation_text'] = ''
        self.factory_catalog = patch('app.model_service.read_equipment', return_value=item)
        self.factory_catalog.start()
        self.addCleanup(self.factory_catalog.stop)
        result = analyze_with_model(self.payload)
        self.assertEqual(result.documentation_status, 'unavailable')
        self.assertEqual(result.documentation_sources, [])

    def test_unknown_device_does_not_call_model(self):
        from app.catalog import EquipmentNotFound
        self.payload.equipment_id = 'missing'
        with self.assertRaises(EquipmentNotFound):
            analyze_with_model(self.payload)
        self.factory.assert_not_called()

    def test_report(self):
        self.answer(symptoms=['Reported extrusion failure'], missing_information=[])
        result = analyze_with_model(self.payload)
        self.assertTrue(result.preliminary)
        self.assertEqual(result.ticket_id, self.payload.ticket_id)

    def test_incomplete_or_refusal(self):
        for status in ['completed', 'incomplete']:
            self.parse.return_value = SimpleNamespace(status=status, output_parsed=None)
            with self.assertRaises(ModelUnavailable):
                analyze_with_model(self.payload)

    def test_invalid_output(self):
        self.answer(symptoms=['   '])
        with self.assertRaises(ModelUnavailable):
            analyze_with_model(self.payload)

    def test_provider_error_is_sanitized(self):
        self.parse.side_effect = OpenAIError('sensitive provider detail')
        with self.assertRaises(ModelUnavailable) as ctx:
            analyze_with_model(self.payload)
        self.assertNotIn('sensitive', str(ctx.exception))

    def test_missing_key_never_calls_provider(self):
        with patch.dict('os.environ', {'AZURE_OPENAI_API_KEY': ''}):
            with self.assertRaises(ModelUnavailable):
                analyze_with_model(self.payload)
        self.factory.assert_not_called()


class OpenRouterTests(unittest.TestCase):
    def setUp(self):
        ModelTests.setUp(self)
        self.router_env = patch.dict('os.environ', {
            'MODEL_PROVIDER': 'openrouter', 'OPENROUTER_API_KEY': 'test-not-real',
            'OPENROUTER_MODEL': 'nvidia/nemotron-3.5-super-vl:free'})
        self.router_env.start()
        self.addCleanup(self.router_env.stop)
        self.create = self.factory.return_value.__enter__.return_value.chat.completions.create

    def test_openrouter_report_and_free_only(self):
        data = ModelAnswer(symptoms=['Upload fails'], possible_causes=[],
                           recommended_checks=['Inspect the selected port'], missing_information=[])
        self.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
            finish_reason='stop', message=SimpleNamespace(refusal=None, content=data.model_dump_json()))])
        result = analyze_with_model(self.payload)
        self.assertEqual(result.ticket_id, self.payload.ticket_id)
        options = self.create.call_args.kwargs
        self.assertEqual(options['response_format']['type'], 'json_schema')
        self.assertTrue(options['extra_body']['provider']['require_parameters'])
        self.assertNotIn('REQ-9', str(options))
        self.assertEqual(self.factory.call_args.kwargs['base_url'], 'https://openrouter.ai/api/v1')
        with patch.dict('os.environ', {'OPENROUTER_MODEL': 'paid/model'}):
            with self.assertRaises(ModelUnavailable):
                analyze_with_model(self.payload)
        self.assertEqual(self.create.call_count, 1)

    def test_bad_router_output_is_rejected(self):
        for content, finish, refusal in [('not json', 'stop', None), ('{}', 'stop', None),
                                         ('{}', 'length', None), ('{}', 'stop', 'refused')]:
            self.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
                finish_reason=finish, message=SimpleNamespace(content=content, refusal=refusal))])
            with self.assertRaises(ModelUnavailable):
                analyze_with_model(self.payload)

    def test_router_key_missing(self):
        with patch.dict('os.environ', {'OPENROUTER_API_KEY': ''}):
            with self.assertRaises(ModelUnavailable):
                analyze_with_model(self.payload)
        self.factory.assert_not_called()
        self.retrieval.assert_not_called()

    def test_router_error_no_paid_fallback(self):
        self.create.side_effect = OpenAIError('sensitive upstream detail')
        with self.assertRaises(ModelUnavailable) as error:
            analyze_with_model(self.payload)
        self.assertEqual(str(error.exception), '')
        self.assertEqual(self.create.call_count, 1)
