from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, A6, landscape
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


OUT = Path(__file__).resolve().parents[1] / "output" / "pdf"
NAVY = colors.HexColor("#0B2C56")
GOLD = colors.HexColor("#E1A925")
INK = colors.HexColor("#172638")
PALE = colors.HexColor("#EFF4F8")
GRAY = colors.HexColor("#6C7785")
WHITE = colors.white


def text(c, value, x, y, font="Helvetica", size=10, color=INK, align="left"):
    c.setFont(font, size)
    c.setFillColor(color)
    if align == "center":
        c.drawCentredString(x, y, value)
    elif align == "right":
        c.drawRightString(x, y, value)
    else:
        c.drawString(x, y, value)


def wordmark(c, x, y, scale=1.0, light=False):
    color = WHITE if light else NAVY
    text(c, "TERAS", x, y, "Helvetica-Bold", 18 * scale, color)
    c.setFillColor(GOLD)
    c.rect(x, y - 5 * scale, 53 * scale, 2.5 * scale, stroke=0, fill=1)
    text(c, "UNIVERSAL SDN. BHD.", x, y - 15 * scale, "Helvetica-Bold", 5.2 * scale, color)


def corner(c, w, h):
    c.setFillColor(NAVY)
    c.rect(0, h - 50, w, 50, stroke=0, fill=1)
    c.setFillColor(GOLD)
    c.rect(0, h - 54, w * .32, 4, stroke=0, fill=1)


def certificate():
    path = OUT / "TERAS_Certificate_of_Completion.pdf"
    w, h = landscape(A4)
    c = canvas.Canvas(str(path), pagesize=(w, h))
    c.setTitle("TERAS Certificate of Completion")
    c.setFillColor(WHITE); c.rect(0, 0, w, h, stroke=0, fill=1)
    c.setStrokeColor(NAVY); c.setLineWidth(1.3); c.rect(22, 22, w - 44, h - 44, stroke=1, fill=0)
    c.setStrokeColor(GOLD); c.setLineWidth(4); c.rect(30, 30, w - 60, h - 60, stroke=1, fill=0)
    c.setFillColor(NAVY); c.rect(0, h - 70, w, 70, stroke=0, fill=1)
    wordmark(c, 48, h - 38, 1.05, light=True)
    text(c, "BUILDING COMPETENCE. CREATING OPPORTUNITIES.", w - 48, h - 39, "Helvetica-Bold", 8, WHITE, "right")
    text(c, "CERTIFICATE OF COMPLETION", w / 2, h - 126, "Helvetica-Bold", 25, NAVY, "center")
    text(c, "This certificate is proudly presented to", w / 2, h - 162, "Helvetica", 11, GRAY, "center")
    text(c, "[ PARTICIPANT NAME ]", w / 2, h - 204, "Helvetica-Bold", 24, INK, "center")
    c.setStrokeColor(GOLD); c.setLineWidth(1.2); c.line(w * .27, h - 213, w * .73, h - 213)
    text(c, "for successfully completing", w / 2, h - 242, "Helvetica", 11, GRAY, "center")
    text(c, "[ TRAINING PROGRAMME / COURSE TITLE ]", w / 2, h - 274, "Helvetica-Bold", 15, NAVY, "center")
    text(c, "Conducted on [ DATE ] at [ VENUE ]", w / 2, h - 300, "Helvetica", 10, INK, "center")
    text(c, "Issued by TERAS UNIVERSAL SDN. BHD.", w / 2, h - 324, "Helvetica", 9, GRAY, "center")
    c.setStrokeColor(NAVY); c.setLineWidth(.7)
    for x, label in ((w*.25, "TRAINER / AUTHORISED SIGNATURE"), (w*.75, "CERTIFICATE NO.")):
        c.line(x - 86, 80, x + 86, 80)
        text(c, label, x, 65, "Helvetica-Bold", 7.5, NAVY, "center")
    text(c, "[ SIGNATURE ]", w*.25, 91, "Helvetica-Oblique", 9, GRAY, "center")
    text(c, "TU-[ YYYY ]-[ 0000 ]", w*.75, 91, "Helvetica-Bold", 9, INK, "center")
    c.showPage(); c.save()


def participant_card():
    path = OUT / "TERAS_Participant_Card.pdf"
    w, h = landscape(A6)
    c = canvas.Canvas(str(path), pagesize=(w, h))
    c.setTitle("TERAS Participant Card")
    c.setFillColor(WHITE); c.rect(0, 0, w, h, stroke=0, fill=1)
    c.setFillColor(NAVY); c.rect(0, h - 48, w, 48, stroke=0, fill=1)
    wordmark(c, 17, h - 24, .75, light=True)
    text(c, "PARTICIPANT", w - 17, h - 25, "Helvetica-Bold", 7.5, WHITE, "right")
    c.setFillColor(PALE); c.roundRect(17, 47, 57, 68, 5, stroke=0, fill=1)
    text(c, "PHOTO", 45.5, 80, "Helvetica-Bold", 8, GRAY, "center")
    text(c, "[ PARTICIPANT NAME ]", 87, 111, "Helvetica-Bold", 12, NAVY)
    text(c, "[ JOB TITLE / COMPANY ]", 87, 95, "Helvetica", 7.5, GRAY)
    text(c, "PROGRAMME", 87, 73, "Helvetica-Bold", 6.5, GOLD)
    text(c, "[ TRAINING TITLE ]", 87, 62, "Helvetica-Bold", 8, INK)
    text(c, "ID  [ TU-0000 ]", 17, 30, "Helvetica-Bold", 7, NAVY)
    text(c, "Valid for the stated training session only.", w - 17, 30, "Helvetica", 6.5, GRAY, "right")
    c.setFillColor(GOLD); c.rect(0, 0, w, 8, stroke=0, fill=1)
    c.showPage(); c.save()


def attendance():
    path = OUT / "TERAS_Training_Attendance_Register.pdf"
    w, h = landscape(A4)
    c = canvas.Canvas(str(path), pagesize=(w, h))
    c.setTitle("TERAS Training Attendance Register")
    corner(c, w, h)
    wordmark(c, 34, h - 27, .8, light=True)
    text(c, "TRAINING ATTENDANCE REGISTER", w - 34, h - 28, "Helvetica-Bold", 12, WHITE, "right")
    text(c, "TRAINING DETAILS", 34, h - 88, "Helvetica-Bold", 10, NAVY)
    fields = [("Programme / Course", "[ TRAINING TITLE ]"), ("Date", "[ DD MONTH YYYY ]"), ("Venue", "[ VENUE ]"), ("Trainer", "[ TRAINER NAME ]")]
    x_positions = [34, w*.29, w*.54, w*.78]
    for (label, value), x in zip(fields, x_positions):
        text(c, label.upper(), x, h - 104, "Helvetica-Bold", 6.5, GOLD)
        text(c, value, x, h - 118, "Helvetica-Bold", 8.5, INK)
        c.setStrokeColor(colors.HexColor("#CBD5DF")); c.setLineWidth(.6); c.line(x, h - 123, x + w*.19, h - 123)
    y_top = h - 151
    cols = [30, 62, 212, 150, 110, 130, 100]
    headers = ["NO.", "ID", "PARTICIPANT NAME", "COMPANY / ORGANISATION", "PHONE", "SIGN IN", "SIGN OUT"]
    x = 34
    c.setFillColor(NAVY); c.rect(34, y_top - 22, sum(cols), 22, stroke=0, fill=1)
    for width, header in zip(cols, headers):
        text(c, header, x + 6, y_top - 14, "Helvetica-Bold", 6.5, WHITE)
        x += width
    row_h = 22
    for row in range(15):
        y = y_top - 22 - (row + 1) * row_h
        c.setFillColor(WHITE if row % 2 == 0 else PALE)
        c.rect(34, y, sum(cols), row_h, stroke=0, fill=1)
        c.setStrokeColor(colors.HexColor("#C9D3DD")); c.setLineWidth(.35)
        x = 34
        for width in cols:
            c.rect(x, y, width, row_h, stroke=1, fill=0)
            x += width
        text(c, str(row + 1), 45, y + 7, "Helvetica", 7, GRAY)
    text(c, "Please sign in upon arrival and sign out after the session.", 34, 34, "Helvetica", 7.5, GRAY)
    text(c, "TERAS UNIVERSAL SDN. BHD. | Building Competence. Creating Opportunities.", w - 34, 34, "Helvetica-Bold", 7.5, NAVY, "right")
    c.showPage(); c.save()


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    certificate()
    participant_card()
    attendance()
    print(f"Created files in {OUT}")
