// Builds tests/unit/fixtures/base.pdf, then encrypts it with pypdf (python) into
// RC4-40 and RC4-128 variants used by the security tests (AES variants need the
// python `cryptography` package, AES is covered by pdf.js cross-checks instead).
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'unit', 'fixtures')
const doc = await PDFDocument.create()
doc.setTitle('Секретный документ')
const font = await doc.embedFont(StandardFonts.Helvetica)
for (let i = 1; i <= 2; i++) doc.addPage([400, 300]).drawText(`Hello secret page ${i}`, { x: 40, y: 150, size: 20, font })
writeFileSync(join(dir, 'base.pdf'), await doc.save({ useObjectStreams: false }))

const py = `
import sys
from pypdf import PdfReader, PdfWriter
from pypdf.constants import UserAccessPermissions as P
d = sys.argv[1]
perms = P.PRINT | P.EXTRACT_TEXT_AND_GRAPHICS
for name, alg in [('rc4-40', 'RC4-40'), ('rc4-128', 'RC4-128')]:
    w = PdfWriter(clone_from=PdfReader(d + '/base.pdf'))
    w.encrypt(user_password='user', owner_password='owner', algorithm=alg, permissions_flag=perms)
    with open(d + '/' + name + '.pdf', 'wb') as f:
        w.write(f)
`
execFileSync('python', ['-c', py, dir], { stdio: 'inherit' })
console.log('fixtures written to', dir)
