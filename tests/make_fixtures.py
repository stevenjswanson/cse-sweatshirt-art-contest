"""Write synthetic PNG and PDF fixtures into tests/fixtures/ for check.js."""
import os, struct, zlib

OUT = os.path.join(os.path.dirname(__file__), 'fixtures')
os.makedirs(OUT, exist_ok=True)

def png(w, h):
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + b'\x00' * w for _ in range(h))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))

def pdf(boxes, rotate=False):
    objs = ['<< /Type /Catalog /Pages 2 0 R >>']
    kids = ' '.join(f'{3 + i} 0 R' for i in range(len(boxes)))
    objs.append(f'<< /Type /Pages /Kids [{kids}] /Count {len(boxes)} >>')
    for w, h in boxes:
        objs.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] {"/Rotate 90" if rotate else ""} >>')
    out, offs = b'%PDF-1.4\n', []
    for i, o in enumerate(objs):
        offs.append(len(out))
        out += f'{i + 1} 0 obj\n{o}\nendobj\n'.encode()
    x = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode()
    out += b''.join(f'{o:010d} 00000 n \n'.encode() for o in offs)
    out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n'.encode()
    return out

for w, h in [(1024, 1024), (1023, 1024), (1030, 1024), (1040, 1024), (2048, 1024)]:
    open(os.path.join(OUT, f'p_{w}x{h}.png'), 'wb').write(png(w, h))
open(os.path.join(OUT, 'd_square.pdf'), 'wb').write(pdf([(612, 612), (500, 500)]))
open(os.path.join(OUT, 'd_letter.pdf'), 'wb').write(pdf([(612, 612), (612, 792)]))
open(os.path.join(OUT, 'd_rot.pdf'), 'wb').write(pdf([(400, 300)], rotate=True))
