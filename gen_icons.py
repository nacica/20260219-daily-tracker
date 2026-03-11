import math
from PIL import Image, ImageDraw, ImageFilter

def create_icon(size=512):
    S = size
    cx, cy = S // 2, S // 2

    # Color constants
    BG    = (2, 4, 8, 255)
    CYAN  = (0, 212, 255, 255)
    WHITE = (255, 255, 255, 255)

    img  = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Rounded-square background
    r = int(S * 0.22)
    draw.rounded_rectangle([0, 0, S, S], radius=r, fill=BG)

    # 2. Inner panel rings (glow border)
    for i in range(8):
        a   = max(0, 20 - i * 2)
        off = int(S * 0.02) + i * int(S * 0.025)
        draw.rounded_rectangle([off, off, S-off, S-off],
                                radius=max(4, r - i*6),
                                outline=(0, 212, 255, a), width=2)

    # 3. Hex grid background texture
    hex_r = S * 0.07
    for row in range(-1, 10):
        for col in range(-1, 10):
            hx = col * hex_r * 1.73 + (row % 2) * hex_r * 0.87 - hex_r
            hy = row * hex_r * 1.5 - hex_r
            pts = []
            for k in range(6):
                ang = math.radians(k * 60)
                pts.append((hx + hex_r * 0.48 * math.cos(ang),
                             hy + hex_r * 0.48 * math.sin(ang)))
            draw.polygon(pts, outline=(0, 212, 255, 10), width=1)

    # 4. Outer ring
    ring_r = int(S * 0.43)
    thick  = max(2, S // 100)
    for gw, a in [(thick*4, 18), (thick*2, 50), (thick, 160)]:
        draw.ellipse([cx-ring_r, cy-ring_r, cx+ring_r, cy+ring_r],
                     outline=(0, 212, 255, a), width=gw)

    # 5. Hexagonal frame
    hex_frame_r = S * 0.36
    hex_pts = []
    for k in range(6):
        ang = math.radians(90 + k * 60)
        hex_pts.append((cx + hex_frame_r * math.cos(ang),
                         cy + hex_frame_r * math.sin(ang)))
    for gw, a in [(int(S*0.016), 40), (int(S*0.008), 140)]:
        draw.polygon(hex_pts, outline=(0, 212, 255, a), width=max(1, gw))

    # 6. Neural node network
    node_r   = S * 0.26
    sat_r    = S * 0.015
    center_r = S * 0.028
    sat_nodes = []
    for k in range(6):
        ang = math.radians(90 + k * 60)
        sat_nodes.append((cx + node_r * math.cos(ang),
                           cy + node_r * math.sin(ang)))

    # Lines: center to satellites
    for sx, sy in sat_nodes:
        draw.line([(cx, cy), (sx, sy)], fill=(0, 212, 255, 80),
                  width=max(1, S // 180))

    # Lines: satellite ring
    for i in range(6):
        a, b = sat_nodes[i], sat_nodes[(i+1) % 6]
        draw.line([a, b], fill=(0, 212, 255, 45), width=max(1, S // 256))

    # Lines: cross connections
    for i in range(3):
        a, b = sat_nodes[i], sat_nodes[i+3]
        draw.line([a, b], fill=(100, 50, 220, 30), width=max(1, S // 320))

    # 7. Satellite nodes
    for sx, sy in sat_nodes:
        outer = int(sat_r * 1.8)
        inner = int(sat_r)
        draw.ellipse([sx-outer, sy-outer, sx+outer, sy+outer],
                     fill=(100, 50, 220, 200))
        draw.ellipse([sx-inner, sy-inner, sx+inner, sy+inner],
                     fill=CYAN)

    # 8. Central node with glow rings
    for rr, a in [(center_r*3.5, 18), (center_r*2.5, 35),
                  (center_r*1.8, 70), (center_r, 255)]:
        ri  = int(rr)
        col = (0, 212, 255, a) if a < 255 else CYAN
        draw.ellipse([cx-ri, cy-ri, cx+ri, cy+ri], fill=col)
    # hot white core
    wc = int(center_r * 0.4)
    draw.ellipse([cx-wc, cy-wc, cx+wc, cy+wc], fill=WHITE)

    # 9. Scan lines
    step = max(3, S // 80)
    for y in range(0, S, step):
        draw.line([(0, y), (S, y)], fill=(0, 212, 255, 6), width=1)

    # 10. Corner targeting brackets
    bpad = int(S * 0.055)
    blen = int(S * 0.10)
    bthk = max(2, S // 100)
    corners = [(bpad, bpad, 1, 1), (S-bpad, bpad, -1, 1),
                (bpad, S-bpad, 1, -1), (S-bpad, S-bpad, -1, -1)]
    for bx, by, dx, dy in corners:
        draw.line([(bx, by), (bx + dx*blen, by)],
                  fill=(0, 212, 255, 200), width=bthk)
        draw.line([(bx, by), (bx, by + dy*blen)],
                  fill=(0, 212, 255, 200), width=bthk)

    # 11. Glow composite pass
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd   = ImageDraw.Draw(glow)
    ci   = int(center_r)
    gd.ellipse([cx-ci, cy-ci, cx+ci, cy+ci], fill=(0, 212, 255, 255))
    for sx, sy in sat_nodes:
        ri = int(sat_r * 1.4)
        gd.ellipse([sx-ri, sy-ri, sx+ri, sy+ri], fill=(0, 212, 255, 200))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=S // 28))
    img  = Image.alpha_composite(img, glow)

    return img


BASE = r"c:\Users\USER\Desktop\20260219行動分析ツール\frontend\icons"

icon_512 = create_icon(512)
icon_512.save(f"{BASE}/icon-512.png", "PNG")
print("icon-512.png saved")

icon_192 = create_icon(192)
icon_192.save(f"{BASE}/icon-192.png", "PNG")
print("icon-192.png saved")

# apple-touch-icon: solid background (no transparency) for iOS
icon_raw = create_icon(180)
bg180 = Image.new('RGB', (180, 180), (2, 4, 8))
bg180.paste(icon_raw, mask=icon_raw.split()[3])
bg180.save(f"{BASE}/apple-touch-icon.png", "PNG")
print("apple-touch-icon.png saved")

print("All icons generated successfully!")
