"""Regenerates the app icon vectors in android/app/src/main/res/drawable from client/public/favicon.svg.

Run from anywhere: python3 android/tools/make_icon.py. The launcher background color is
ic_launcher_background in res/values/colors.xml."""
import re, sys, xml.etree.ElementTree as ET
import os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ns = {'s': 'http://www.w3.org/2000/svg'}
svg = ET.parse(f'{ROOT}/client/public/favicon.svg').getroot()
grads = {}
for g in svg.iter('{http://www.w3.org/2000/svg}linearGradient'):
    grads[g.get('id')] = (g.get('y1'), g.get('y2'), [(s.get('offset'), s.get('stop-color')) for s in g])
def circle(cx, cy, r):
    cx, cy, r = float(cx), float(cy), float(r)
    return f'M{cx-r:.3f},{cy}a{r},{r} 0,1 0,{2*r:.3f},0a{r},{r} 0,1 0,{-2*r:.3f},0z'
shapes = []  # (pathData, fill)
for el in svg:
    tag = el.tag.split('}')[1]
    if tag == 'path': shapes.append((el.get('d'), el.get('fill')))
    if tag == 'circle': shapes.append((circle(el.get('cx'), el.get('cy'), el.get('r')), el.get('fill')))
head, nose, whiskL, whiskR = shapes[0], shapes[1], shapes[8], shapes[9]
eyeL, earL, earR, glintL, eyeR, glintR = shapes[2], shapes[3], shapes[4], shapes[5], shapes[6], shapes[7]

def hexa(c):  # SVG #RRGGBB -> Android #FFRRGGBB
    return '#FF' + c.lstrip('#').upper()
def vd_fill(fill):
    m = re.match(r'url\(#(\w+)\)', fill)
    if not m: return f' android:fillColor="{hexa(fill)}"', ''
    y1, y2, stops = grads[m.group(1)]
    items = ''.join(f'\n                    <item android:offset="{o}" android:color="{hexa(c)}"/>' for o, c in stops)
    return '', f'''
            <aapt:attr name="android:fillColor">
                <gradient android:type="linear" android:startX="500" android:startY="{y1}" android:endX="500" android:endY="{y2}">{items}
                </gradient>
            </aapt:attr>'''
def vector(size, viewport, scale, center, paths, extra_ns=True):
    tx, ty = viewport / 2 - center[0] * scale, viewport / 2 - center[1] * scale
    body = ''
    for d, fill, *rest in paths:
        attr, child = vd_fill(fill)
        ft = ' android:fillType="evenOdd"' if rest and rest[0] else ''
        body += f'\n        <path{attr}{ft} android:pathData="{d}"' + (f'>{child}\n        </path>' if child else '/>')
    return f'''<vector xmlns:android="http://schemas.android.com/apk/res/android"{' xmlns:aapt="http://schemas.android.com/aapt"' if extra_ns else ''}
    android:width="{size}dp" android:height="{size}dp" android:viewportWidth="{viewport}" android:viewportHeight="{viewport}">
    <!-- Generated from client/public/favicon.svg -->
    <group android:scaleX="{scale}" android:scaleY="{scale}" android:translateX="{tx:.3f}" android:translateY="{ty:.3f}">{body}
    </group>
</vector>
'''
CENTER = (500, 475)  # middle of the cat, whiskers included
color_paths = [head, earL, earR, nose, eyeL, glintL, eyeR, glintR, whiskL, whiskR]
# One-color silhouette (themed icons, notifications): head with the eyes and nose cut out, plus whiskers.
silhouette = [(head[0] + eyeL[0] + eyeR[0] + nose[0], '#FFFFFF', True), (whiskL[0], '#FFFFFF'), (whiskR[0], '#FFFFFF')]
res = f'{ROOT}/android/app/src/main/res'
open(f'{res}/drawable/ic_launcher_foreground.xml', 'w').write(vector(108, 108, 0.078, CENTER, color_paths))
open(f'{res}/drawable/ic_launcher_monochrome.xml', 'w').write(vector(108, 108, 0.078, CENTER, silhouette, False))
open(f'{res}/drawable/ic_notification.xml', 'w').write(vector(24, 24, 0.0285, CENTER, silhouette, False))
