"""Exercise real HTTP validation and the report-only success schema without a model."""

import json
import os
import socket
import subprocess
import sys
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import TypeAdapter, ValidationError

from app.schemas import AnalysisResponse


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        from app.catalog import initialize
        cls.temp = TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.db_env = patch.dict(os.environ, {'LEMS_CATALOG_PATH': cls.temp.name + '/catalog.db'})
        cls.db_env.start()
        cls.addClassCleanup(cls.db_env.stop)
        initialize()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        cls.base = f'http://127.0.0.1:{port}'
        cls.process = subprocess.Popen(
            [sys.executable, '-m', 'uvicorn', 'app.main:app', '--port', str(port)],
            cwd=Path(__file__).resolve().parents[1],
            env={**os.environ, "AZURE_OPENAI_API_KEY": ""},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        cls.addClassCleanup(cls.stop_server)
        for _ in range(50):
            try:
                with urlopen(cls.base + '/health', timeout=1):
                    return
            except URLError:
                time.sleep(0.1)
        raise RuntimeError('Server failed to start')

    @classmethod
    def stop_server(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)

    def post(self, body):
        request = Request(self.base + '/api/v1/maintenance/analyze',
                          data=body, headers={'Content-Type': 'application/json'})
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def test_valid_request_reports_unconfigured_model(self):
        status, body = self.post(json.dumps(self.valid()).encode())
        self.assertEqual(status, 503)
        self.assertEqual(body['error']['code'], 'MODEL_UNAVAILABLE')
        self.assertNotIn('result_type', body)

    @staticmethod
    def valid():
        return dict(ticket_id='REQ-104', equipment_id='PRN-001',
                    problem_description='No filament comes out.')

    def test_invalid_requests(self):
        cases = [{}, {**self.valid(), 'ticket_id': 104},
                 {**self.valid(), 'equipment_id': '  '},
                 {**self.valid(), 'problem_description': None},
                 {**self.valid(), 'problem_description': 'x' * 4001},
                 {**self.valid(), 'unknown': 'value'}]
        for case in cases:
            with self.subTest(case=case):
                status, body = self.post(json.dumps(case).encode())
                self.assertEqual(status, 422)
                self.assertEqual(body['error']['code'], 'VALIDATION_ERROR')
        self.assertEqual(self.post(b'{invalid')[0], 422)

    def test_success_contract(self):
        adapter = TypeAdapter(AnalysisResponse)
        report = dict(ticket_id='1', result_type='report', symptoms=[],
                      possible_causes=[], recommended_checks=[],
                      missing_information=['Equipment symptoms were not provided.'],
                      documentation_status='unavailable', documentation_sources=[])
        adapter.validate_python(report)
        for invalid in [{**report, 'result_type': 'clarification'},
                        {**report, 'questions': ['What happened?']},
                        {**report, 'missing_information': ['  ']}]:
            with self.assertRaises(ValidationError):
                adapter.validate_python(invalid)
        del report['missing_information']
        with self.assertRaises(ValidationError):
            adapter.validate_python(report)

    def test_openapi_exposes_contract(self):
        with urlopen(self.base + '/openapi.json', timeout=3) as response:
            operation = json.load(response)['paths']['/api/v1/maintenance/analyze']['post']
        self.assertTrue({'200', '422', '503'} <= operation['responses'].keys())
        schema = operation['responses']['200']['content']['application/json']['schema']
        self.assertEqual(schema['$ref'], '#/components/schemas/ReportResponse')
