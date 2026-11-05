# Optional asset regeneration: Python 3 + Pillow. The site build uses the checked-in PNG.
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'assets'
OUT.mkdir(parents=True, exist_ok=True)
SCALE = 2
NAVY = '#0f1d30'
GOLD = '#ffcd00'
CREAM = '#f7f2e6'
image = Image.new('RGB', (1200*SCALE, 630*SCALE), NAVY)
draw = ImageDraw.Draw(image)

def font(name, size):
    return ImageFont.truetype(str(ROOT/'assets'/name), size*SCALE)

def text_at(text, family, size, x, y, color):
    face = font(family, size)
    bounds = draw.textbbox((0,0), text, font=face)
    draw.text((x*SCALE-bounds[0], y*SCALE-bounds[1]), text, font=face, fill=color)

# Everything meaningful fits within the central 80% of the canvas. The solid
# navy background and opaque output prevent transparent-logo fallback colors.
text_at('UCSD', 'race.ttf', 108, 120, 116, GOLD)
wordmark = Image.open(ROOT/'assets'/'cannonball-wordmark.png').convert('RGBA')
wordmark = wordmark.resize((960*SCALE, round(203*960/968)*SCALE), Image.Resampling.LANCZOS)
image.paste(wordmark, (120*SCALE, 236*SCALE), wordmark)

# A familiar speed mark, restrained so the typography remains the hero.
for x, width in [(977,10),(1003,14),(1033,20)]:
    draw.polygon([(x*SCALE,149*SCALE),((x+width)*SCALE,149*SCALE),
                  ((x+width-15)*SCALE,189*SCALE),((x-15)*SCALE,189*SCALE)],fill=GOLD)

tagline = 'POINT A  POINT B  NO RULES'
tag_font = font('panel.ttf', 38)
tag_bounds = draw.textbbox((0,0), tagline, font=tag_font)
tag_width = tag_bounds[2]-tag_bounds[0]
draw.text(((1200*SCALE-tag_width)/2-tag_bounds[0],486*SCALE-tag_bounds[1]),
          tagline,font=tag_font,fill=CREAM)

image = image.resize((1200,630), Image.Resampling.LANCZOS)
image.save(OUT/'social-preview-v1.png', optimize=True)

print('Generated assets/social-preview-v1.png: opaque RGB, 1200 x 630.')
