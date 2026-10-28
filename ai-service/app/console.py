"""One-request console runner using the same pipeline as the HTTP API."""
import argparse
import os
import sys
from time import perf_counter

from pydantic import ValidationError
from app.catalog import read_equipment, EquipmentNotFound, CatalogUnavailable
from app.model_service import analyze_with_model, ModelUnavailable
from app.retrieval import RetrievalUnavailable
from app.schemas import AnalysisRequest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--list', action='store_true', help='List equipment; no model call')
    parser.add_argument('--equipment', help='Equipment ID; prompted if omitted')
    parser.add_argument('--problem', help='English problem description; prompted if omitted')
    parser.add_argument('--ticket', default='CONSOLE-TEST', help='Local report reference')
    parser.add_argument('--json', action='store_true', help='Print report as JSON')
    parser.add_argument('--retrieval', choices=['summary', 'full'], help='Override RETRIEVAL_MODE for this run')
    args = parser.parse_args(argv)
    previous_mode = os.environ.get('RETRIEVAL_MODE')
    if args.retrieval:
        os.environ['RETRIEVAL_MODE'] = args.retrieval
    started = perf_counter()

    def progress(message):
        # stderr contains only stages/timing, never credentials or raw provider errors.
        print(f'[+{perf_counter() - started:.1f}s] {message}', file=sys.stderr, flush=True)

    try:
        if args.list:
            for item in read_equipment():
                print(f"{item['id']}: {item['name']} ({item['model'] or 'model not specified'})")
            return 0
        equipment = args.equipment if args.equipment is not None else input('Equipment ID (e.g. ARD-001): ')
        problem = args.problem if args.problem is not None else input('Describe the problem in English: ')
        payload = AnalysisRequest(ticket_id=args.ticket, equipment_id=equipment,
                                  problem_description=problem)
        started = perf_counter()
        progress('Path: console -> Python pipeline -> catalog -> semantic search -> model -> report')
        progress('Console runs the pipeline directly; no HTTP server is required.')
        report = analyze_with_model(payload, progress=progress)
        if args.json:
            print(report.model_dump_json(indent=2))
        else:
            print(f'\nPreliminary report: {report.ticket_id} (human verification required)')
            for title, values in [('Symptoms', report.symptoms),
                                  ('Possible causes', report.possible_causes),
                                  ('Recommended checks', report.recommended_checks),
                                  ('Missing information', report.missing_information)]:
                print(f'\n{title}:')
                for value in values or ['None reported.']:
                    print(f'  - {value}')
            print(f'\nDocumentation: {report.documentation_status}; mode: {report.retrieval_mode}')
            for source in report.documentation_sources:
                print(f'  [{source.source_id}] {source.url}\n  {source.section}; ' +
                      (f'downloaded {source.retrieved_at}' if source.retrieved_at else f'reviewed {source.verified_at}'))
        return 0
    except ValidationError:
        progress('ERROR VALIDATION_ERROR: IDs must be 1-100 characters; description 1-4000.')
    except EquipmentNotFound:
        progress('ERROR EQUIPMENT_NOT_FOUND: use --list to view equipment IDs.')
    except CatalogUnavailable:
        progress('ERROR CATALOG_UNAVAILABLE: check DATABASE_URL, certificate and database access.')
    except RetrievalUnavailable:
        progress('ERROR RETRIEVAL_UNAVAILABLE: check local weights and the selected mode; full mode requires an indexed document_chunks table.')
    except ModelUnavailable:
        progress('ERROR MODEL_UNAVAILABLE: check provider configuration, quota and availability; no paid fallback.')
    except (EOFError, KeyboardInterrupt):
        progress('Cancelled.')
        return 130
    finally:
        if args.retrieval:
            if previous_mode is None:
                os.environ.pop("RETRIEVAL_MODE", None)
            else:
                os.environ["RETRIEVAL_MODE"] = previous_mode
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
