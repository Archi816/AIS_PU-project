"""Verify persistence, source boundaries and API errors without Azure calls."""
from contextlib import closing
import os
import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from app.catalog import initialize, read_equipment, documentation_context, EquipmentNotFound, CatalogUnavailable
from app.schemas import AnalysisRequest
from app.main import analyze, equipment_list

class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'catalog.db'
        self.env = patch.dict(os.environ, {'LEMS_CATALOG_PATH': str(self.path)})
        self.env.start()
        self.addCleanup(self.env.stop)
        initialize()

    def test_seed_is_idempotent_and_preserves_edits(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE equipment SET name='Edited' WHERE id='ARD-001'")
        initialize()
        self.assertEqual(len(read_equipment()), 7)
        self.assertEqual(read_equipment('ARD-001')['name'], 'Edited')

    def test_lookup_does_not_interpret_sql(self):
        with self.assertRaises(EquipmentNotFound):
            read_equipment("' OR 1=1 --")

    def test_link_alone_is_not_documentation(self):
        self.assertEqual(documentation_context(read_equipment('PRN-001')), ('', []))
        text, sources = documentation_context(read_equipment('ARD-001'))
        self.assertIn('USB', text)
        self.assertEqual(len(sources), 1)

    def test_missing_database_is_safe(self):
        with patch.dict(os.environ, {'LEMS_CATALOG_PATH': str(self.path.parent / 'missing.db')}):
            self.assertEqual(equipment_list().status_code, 503)
            with self.assertRaises(CatalogUnavailable):
                read_equipment()

    def test_unknown_equipment_returns_404_without_model(self):
        with patch('app.model_service.OpenAI') as client:
            response = analyze(AnalysisRequest(ticket_id='1', equipment_id='missing', problem_description='Failure'))
        self.assertEqual(response.status_code, 404)
        client.assert_not_called()
