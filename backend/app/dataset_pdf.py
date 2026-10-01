from datetime import datetime, timezone
from html import escape
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, TableStyle


def build_dataset_pdf(words: list[str], synced_at: datetime | None = None) -> bytes:
    """Render the complete, alphabetized pose catalog as a printable PDF."""
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm,
        title="NeoTalk - Catálogo de sinais .pose", author="NeoTalk",
    )
    title_style = ParagraphStyle(
        "title", fontName="Helvetica-Bold", fontSize=18, leading=22,
        textColor=colors.HexColor("#10233F"), spaceAfter=9 * mm,
    )
    meta_style = ParagraphStyle(
        "meta", fontName="Helvetica", fontSize=9, leading=13,
        textColor=colors.HexColor("#526074"), spaceAfter=2 * mm,
    )
    word_style = ParagraphStyle(
        "word", fontName="Helvetica", fontSize=9, leading=12,
        textColor=colors.HexColor("#10233F"), alignment=TA_CENTER,
    )
    timestamp = synced_at.astimezone(timezone.utc).strftime("%d/%m/%Y %H:%M UTC") if synced_at else "Não informado"
    story = [
        Paragraph("Catálogo de sinais .pose", title_style),
        Paragraph(f"{len(words)} palavras disponíveis no dataset sincronizado", meta_style),
        Paragraph(f"Última sincronização: {timestamp}", meta_style),
        Spacer(1, 7 * mm),
    ]
    columns = 3
    cells = [Paragraph(escape(word), word_style) for word in words]
    cells.extend([""] * (-len(cells) % columns))
    if cells:
        rows = [cells[index:index + columns] for index in range(0, len(cells), columns)]
        table = LongTable(rows, colWidths=[58 * mm] * columns, hAlign="CENTER")
        table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#E2E8F0")),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ]))
        story.append(table)
    else:
        story.append(Paragraph("Nenhuma palavra sincronizada.", meta_style))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#DCE5EE"))
        canvas.line(18 * mm, 15 * mm, A4[0] - 18 * mm, 15 * mm)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#718096"))
        canvas.drawString(18 * mm, 10 * mm, "NeoTalk  |  Catálogo .pose")
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Página {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
