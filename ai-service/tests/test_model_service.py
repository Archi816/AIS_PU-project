"""Provider-boundary tests use doubles, never Azure credits or real credentials."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from openai import OpenAIError

from app.model_service import ModelAnswer, ModelUnavailable, analyze_with_model
from app.schemas import AnalysisRequest


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.payload = AnalysisRequest(ticket_id='REQ-9', equipment_model='Printer',
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
        data = dict(result_type='clarification', questions=['Any error displayed?'],
                    symptoms=[], possible_causes=[], recommended_checks=[])
        data.update(updates)
        self.parse.return_value = SimpleNamespace(status='completed', output_parsed=ModelAnswer(**data))

    def test_clarification_and_request_options(self):
        self.answer()
        result = analyze_with_model(self.payload)
        self.assertEqual(result.ticket_id, 'REQ-9')
        self.assertEqual(result.result_type, 'clarification')
        kwargs = self.parse.call_args.kwargs
        self.assertNotIn('REQ-9', kwargs['input'])
        self.assertFalse(kwargs['store'])
        self.assertEqual(kwargs['max_output_tokens'], 2000)
        self.assertEqual(self.factory.call_args.kwargs['max_retries'], 0)

    def test_report(self):
        self.answer(result_type='report', questions=[], symptoms=['Reported extrusion failure'])
        result = analyze_with_model(self.payload)
        self.assertTrue(result.preliminary)
        self.assertEqual(result.ticket_id, self.payload.ticket_id)

    def test_incomplete_or_refusal(self):
        for status in ['completed', 'incomplete']:
            self.parse.return_value = SimpleNamespace(status=status, output_parsed=None)
            with self.assertRaises(ModelUnavailable):
                analyze_with_model(self.payload)

    def test_invalid_output(self):
        self.answer(questions=[])
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
