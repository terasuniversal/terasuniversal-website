"""PDF-level regression checks for the document-system visual gate."""
from pathlib import Path
import re
import sys

import fitz

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts" / "document-system-v1-review"


def text(path: Path) -> tuple[list[str], str]:
    document = fitz.open(path)
    pages = [page.get_text() for page in document]
    return pages, "\n".join(pages)


def assert_labels(pages: list[str], total: int) -> None:
    labels = sorted(set(re.findall(r"Page \d+ of \d+", "\n".join(pages))))
    expected = [f"Page {i} of {total}" for i in range(1, total + 1)]
    assert labels == expected, (labels, expected)
    assert "Page 0 of 0" not in "\n".join(pages)
    assert all(f"Page {i} of {total}" in page for i, page in enumerate(pages, 1))


def assert_once(full_text: str, labels: list[str]) -> None:
    counts = {label: len(re.findall(re.escape(label), full_text)) for label in labels}
    assert all(count == 1 for count in counts.values()), counts


def main() -> None:
    quotation_pages, quotation_text = text(ARTIFACTS / "quotation-actual-staging.pdf")
    assert_labels(quotation_pages, len(quotation_pages))
    assert_once(quotation_text, [f"Module {i:02d}" for i in range(1, 19)])

    stress_q_pages, stress_q_text = text(ARTIFACTS / "quotation-multipage.pdf")
    assert len(stress_q_pages) == 2
    assert_labels(stress_q_pages, 2)
    assert_once(stress_q_text, [f"Module {i:02d}" for i in range(1, 9)])

    invoice_pages, invoice_text = text(ARTIFACTS / "invoice-actual-staging.pdf")
    assert_labels(invoice_pages, len(invoice_pages))
    assert "Balance Due" in invoice_text
    assert "Page 0 of 0" not in invoice_text

    stress_i_pages, stress_i_text = text(ARTIFACTS / "invoice-multipage.pdf")
    assert len(stress_i_pages) == 2
    assert_labels(stress_i_pages, 2)
    assert_once(stress_i_text, [f"Invoice Item {i:02d}" for i in range(1, 9)])

    print("Document System V1 PDF visual contract: PASS")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Document System V1 PDF visual contract: FAIL: {exc}")
        sys.exit(1)
