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
            'AZURE_OPENAI_API_KEY': 'test-key-not-real',
            'AZURE_OPENAI_BASE_URL': 'https://test.services.ai.azure.com/openai/v1/',
            'AZURE_OPENAI_DEPLOYMENT': 'gpt-5-mini',
        })
        self.env.start()
        self.addCleanup(self.env.stop)
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
        self.payload.equipment_id = 'PRN-001'
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
