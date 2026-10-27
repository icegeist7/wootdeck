# SPDX-License-Identifier: GPL-3.0-or-later
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import json

themes = json.loads(Path('tmp/previews/themes/index.json').read_text(encoding='utf-8'))
states = [('active','Active'),('inactive','Profile'),('depth','Depth'),('any','Any Key'),('warning','Offline')]
sheet = Image.new('RGB',(20+len(themes)*160,570),'#242424')
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',14)
draw.text((16,10),'WootDeck themes · actual key size: 72 × 72 px',font=font,fill='white')
for col,(theme,title) in enumerate(themes):
    x=20+col*160
    draw.text((x,42),title,font=font,fill='#ddd')
    for row,(state,label) in enumerate(states):
        y=72+row*98
        tile=Image.open(Path('tmp/previews/themes')/f'{theme}-{state}-72.png')
        sheet.paste(tile,(x,y))
        draw.text((x+80,y+25),label,font=font,fill='#bbb')
sheet.save('tmp/previews/themes-preview.png')
