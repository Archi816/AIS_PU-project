"""Deterministic selection tests; real embeddings are checked separately offline."""
import unittest
from unittest.mock import patch
from app.retrieval import chunks, retrieve, document_vectors, RetrievalUnavailable


class RetrievalTests(unittest.TestCase):
    def setUp(self):
        document_vectors.cache_clear()
        self.addCleanup(document_vectors.cache_clear)
        self.item = dict(documentation_text='USB connection failed. ' * 70,
                         documentation_url='https://example.com/manual',
                         documentation_section='USB', documentation_verified_at='2026-10-26')

    def test_no_document_never_loads_model(self):
        with patch('app.retrieval.encoder') as encoder:
            self.item['documentation_text'] = ''
            self.assertEqual(retrieve(self.item, 'error'), ('', []))
            encoder.assert_not_called()

    def test_relevance_filter_and_bounded_context(self):
        import numpy as np
        passages = chunks(self.item['documentation_text'])
        vectors = np.array([[1., 0.]] + [[0., 1.]] * (len(passages)-1))
        with patch('app.retrieval.document_vectors', return_value=vectors), patch('app.retrieval.encoder') as encoder:
            encoder.return_value.query_embed.return_value = iter([np.array([1.,0.])])
            text, sources = retrieve(self.item, 'USB failure')
            self.assertIn('[Excerpt 1]', text)
            self.assertNotIn('[Excerpt 2]', text)
            self.assertEqual(len(sources), 1)
            encoder.return_value.query_embed.return_value = iter([np.array([-1.,0.])])
            self.assertEqual(retrieve(self.item, 'unrelated'), ('', []))

    def test_encoder_failure_is_distinct_from_no_results(self):
        with patch('app.retrieval.encoder', side_effect=RuntimeError('private path')):
            with self.assertRaises(RetrievalUnavailable) as error:
                retrieve(self.item, 'USB failure')
        self.assertEqual(str(error.exception), '')

    def test_content_change_invalidates_vectors(self):
        with patch('app.retrieval.encoder') as encoder:
            encoder.return_value.passage_embed.return_value = [[1., 0.]]
            document_vectors(('old text',))
            document_vectors(('old text',))
            document_vectors(('new text',))
            self.assertEqual(encoder.return_value.passage_embed.call_count, 2)

    def test_chunks_overlap_without_losing_tail(self):
        words = [str(i) for i in range(230)]
        parts = chunks(' '.join(words))
        self.assertTrue(all(len(part.split()) <= 90 for part in parts))
        self.assertEqual(parts[0].split()[-20:], parts[1].split()[:20])
        self.assertEqual(parts[-1].split()[-1], '229')
