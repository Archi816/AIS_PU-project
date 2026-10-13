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
        item = read_equipment('PRN-001')
        item['documentation_text'] = ''
        self.assertEqual(documentation_context(item), ('', []))
        text, sources = documentation_context(read_equipment('ARD-001'))
        self.assertIn('USB', text)
        self.assertEqual(len(sources), 1)

    def test_missing_database_is_safe(self):
        with patch.dict(os.environ, {'LEMS_CATALOG_PATH': str(self.path.parent / 'missing.db')}):
            self.assertEqual(equipment_list().status_code, 503)
            with self.assertRaises(CatalogUnavailable):
                read_equipment()

    def test_fill_missing_preserves_custom_text_and_model(self):
        from app.catalog import fill_missing_documentation
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE equipment SET documentation_text='' WHERE id='PRN-001'")
            db.execute("UPDATE equipment SET documentation_text='Custom' WHERE id='ARD-001'")
            db.execute("UPDATE equipment SET documentation_text='', model='Other' WHERE id='ROB-001'")
        self.assertEqual(fill_missing_documentation(), ['PRN-001'])
        self.assertEqual(read_equipment('ARD-001')['documentation_text'], 'Custom')
        self.assertEqual(read_equipment('ROB-001')['documentation_text'], '')
        self.assertEqual(fill_missing_documentation(), [])

    def test_unknown_equipment_returns_404_without_model(self):
        with patch('app.model_service.OpenAI') as client:
            response = analyze(AnalysisRequest(ticket_id='1', equipment_id='missing', problem_description='Failure'))
        self.assertEqual(response.status_code, 404)
        client.assert_not_called()

    def test_all_demo_entries_are_documented(self):
        rows = read_equipment()
        self.assertEqual(len(rows), 7)
        for item in rows:
            self.assertTrue(item['is_demo'])
            self.assertTrue(item['model'])
            self.assertNotEqual(item['location'], 'Not verified')
            text, sources = documentation_context(item)
            self.assertTrue(text)
            self.assertTrue(sources)

    def test_complete_demo_preserves_real_and_custom_records(self):
        from app.catalog import complete_demo_placeholders
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE equipment SET model=NULL, location='Not verified', condition='unknown', documentation_text='' WHERE id='PC-001'")
            db.execute("UPDATE equipment SET model=NULL, is_demo=0 WHERE id='LAP-001'")
            db.execute("UPDATE equipment SET location='Custom room', condition='maintenance' WHERE id='ROB-001'")
        complete_demo_placeholders()
        self.assertEqual(read_equipment('PC-001')['model'], 'Dell OptiPlex 7090 Micro')
        self.assertIsNone(read_equipment('LAP-001')['model'])
        self.assertEqual(read_equipment('ROB-001')['condition'], 'maintenance')
        self.assertEqual(read_equipment('ROB-001')['location'], 'Custom room')
        self.assertEqual(complete_demo_placeholders(), [])
