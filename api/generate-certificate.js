const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

// ===========================================
// TEMPLATE CONFIGURATION
// ===========================================
// All templates are 4000x3091 pixels
// PDF page will be letter-landscape (792x612 points)
// Scale factor: 792/4000 = 0.198

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;

// Style-to-filename mapping
const STYLE_MAP = {
  classic:  'CLASSIC_ACADEMIA_BG.png',
  boujie:   'BOUGIE___LUXE_BG.png',
  legal:    'LAW_SCHOOL_BG.png',
  medical:  'MEDICAL_BG.png',
  creative: 'CREATIVES_BG.png',
  tech:     'AI_TECH_BG.png',
  kids:     'LIL_PHUCKERS_BG.png',
};

// Per-style layout & font configuration
// Y values are from BOTTOM of page (pdf-lib coordinate system)
// Fonts: TimesRoman, TimesRomanBold, TimesRomanItalic, TimesRomanBoldItalic,
//        Helvetica, HelveticaBold, HelveticaOblique, Courier, CourierBold
const STYLE_LAYOUTS = {
  // Classic Academia — traditional serif throughout
  classic: {
    name:        { y: 310, fontSize: 32, font: 'TimesRomanBold' },
    dateLine:    { y: 280, fontSize: 13, font: 'TimesRomanItalic' },
    degree:      { y: 245, fontSize: 22, font: 'TimesRomanBold' },
    achievement: { y: 218, fontSize: 13, font: 'TimesRomanItalic' },
  },
  // Boujie & Luxe — elegant serif, bold-italic name for extra flair
  boujie: {
    name:        { y: 310, fontSize: 32, font: 'TimesRomanBoldItalic' },
    dateLine:    { y: 280, fontSize: 13, font: 'TimesRomanItalic' },
    degree:      { y: 245, fontSize: 22, font: 'TimesRomanBold' },
    achievement: { y: 218, fontSize: 13, font: 'TimesRomanItalic' },
  },
  // Law School — formal serif, standard italic date
  legal: {
    name:        { y: 310, fontSize: 32, font: 'TimesRomanBold' },
    dateLine:    { y: 280, fontSize: 13, font: 'TimesRomanItalic' },
    degree:      { y: 245, fontSize: 22, font: 'TimesRomanBold' },
    achievement: { y: 218, fontSize: 13, font: 'TimesRomanItalic' },
  },
  // Medical — clean sans-serif name & degree (Helvetica), italic serif details
  medical: {
    name:        { y: 310, fontSize: 32, font: 'HelveticaBold' },
    dateLine:    { y: 280, fontSize: 13, font: 'TimesRomanItalic' },
    degree:      { y: 245, fontSize: 22, font: 'HelveticaBold' },
    achievement: { y: 218, fontSize: 13, font: 'TimesRomanItalic' },
  },
  // Creatives — serif name, italic serif details
  creative: {
    name:        { y: 310, fontSize: 32, font: 'TimesRomanBold' },
    dateLine:    { y: 280, fontSize: 13, font: 'TimesRomanItalic' },
    degree:      { y: 245, fontSize: 22, font: 'TimesRomanBold' },
    achievement: { y: 218, fontSize: 13, font: 'TimesRomanItalic' },
  },
  // AI / Tech — monospace name & degree (Courier), all-caps, underscored names
  tech: {
    nameTransform: 'tech', // signals FIRST_LAST with underscores + uppercase
    name:        { y: 310, fontSize: 28, font: 'CourierBold' },
    dateLine:    { y: 280, fontSize: 13, font: 'TimesRomanItalic' },
    degree:      { y: 245, fontSize: 20, font: 'CourierBold' },
    achievement: { y: 218, fontSize: 13, font: 'TimesRomanItalic' },
  },
  // Lil Phuckers (Kids) — friendly serif, different ordering
  kids: {
    name:        { y: 320, fontSize: 32, font: 'TimesRoman' },
    degree:      { y: 285, fontSize: 22, font: 'TimesRomanBold' },
    achievement: { y: 250, fontSize: 13, font: 'TimesRomanItalic' },
  },
};

// ===========================================
// HELPER: Center text on page
// ===========================================
function drawCenteredText(page, text, y, fontSize, font, color = rgb(0, 0, 0)) {
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const x = (PAGE_WIDTH - textWidth) / 2;
  page.drawText(text, { x, y, size: fontSize, font, color });
}

// ===========================================
// HANDLER
// ===========================================
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      firstName,
      lastName,
      certificationDate,
      degreeLevel,
      faculty,
      achievement,
      style,
      format = 'pdf', // 'pdf' or 'png'
    } = req.body;

    // Validate
    if (!firstName || !lastName || !degreeLevel || !faculty || !achievement || !style) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate style
    const bgFilename = STYLE_MAP[style];
    if (!bgFilename) {
      return res.status(400).json({ error: `Invalid style: ${style}` });
    }

    // Load background image
    // Try multiple paths to work in both Vercel and local environments
    const possiblePaths = [
      path.join(process.cwd(), 'public', bgFilename),
      path.join(__dirname, '..', 'public', bgFilename),
    ];
    const bgPath = possiblePaths.find(p => fs.existsSync(p));
    if (!bgPath) {
      return res.status(500).json({ error: `Background image not found: ${bgFilename}`, searched: possiblePaths });
    }
    const bgBytes = fs.readFileSync(bgPath);

    // Create PDF document
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    // Embed and draw background image
    const bgImage = await pdfDoc.embedPng(bgBytes);
    page.drawImage(bgImage, {
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
    });

    // Load fonts
    const fontMap = {
      TimesRoman:           await pdfDoc.embedFont(StandardFonts.TimesRoman),
      TimesRomanBold:       await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
      TimesRomanItalic:     await pdfDoc.embedFont(StandardFonts.TimesRomanItalic),
      TimesRomanBoldItalic: await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic),
      Helvetica:            await pdfDoc.embedFont(StandardFonts.Helvetica),
      HelveticaBold:        await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      HelveticaOblique:     await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
      Courier:              await pdfDoc.embedFont(StandardFonts.Courier),
      CourierBold:          await pdfDoc.embedFont(StandardFonts.CourierBold),
    };

    // Pick per-style layout
    const layout = STYLE_LAYOUTS[style];
    const textColor = rgb(0, 0, 0);

    // Build text content (apply transforms for specific styles)
    let fullName = `${firstName} ${lastName}`;
    let degreeFull = `${degreeLevel} of ${faculty}`;
    const dateLine = certificationDate
      ? `On this ${certificationDate}, do bestow the degree of:`
      : '';
    const achievementLine = `For outstanding achievement in ${achievement}`;

    // Tech style: FIRST_LAST uppercase with underscores
    if (layout.nameTransform === 'tech') {
      fullName = `${firstName}_${lastName}`.toUpperCase();
      degreeFull = degreeFull.toUpperCase();
    }

    // Draw name
    drawCenteredText(
      page,
      fullName,
      layout.name.y,
      layout.name.fontSize,
      fontMap[layout.name.font],
      textColor
    );

    // Draw date line (not on kids layout)
    if (layout.dateLine && dateLine) {
      drawCenteredText(
        page,
        dateLine,
        layout.dateLine.y,
        layout.dateLine.fontSize,
        fontMap[layout.dateLine.font],
        textColor
      );
    }

    // Draw degree
    drawCenteredText(
      page,
      degreeFull,
      layout.degree.y,
      layout.degree.fontSize,
      fontMap[layout.degree.font],
      textColor
    );

    // Draw achievement
    drawCenteredText(
      page,
      achievementLine,
      layout.achievement.y,
      layout.achievement.fontSize,
      fontMap[layout.achievement.font],
      textColor
    );

    // Serialize PDF
    const pdfBytes = await pdfDoc.save();

    // Return as PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="phuckery-certificate.pdf"`);
    res.status(200).send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('Certificate generation error:', error);
    res.status(500).json({ error: 'Failed to generate certificate', message: error.message });
  }
};
