import {
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFString,
  PDFTextField
} from 'pdf-lib'
import type { FormValue } from '../model'

export interface FormInfo {
  hasFields: boolean
  values: Record<string, FormValue>
  defaults: Record<string, FormValue>
}

/** Reads AcroForm field values (fully qualified names, pdf.js-compatible values). */
export function readFormInfo(doc: PDFDocument): FormInfo {
  const info: FormInfo = { hasFields: false, values: {}, defaults: {} }
  let fields
  try {
    if (!doc.catalog.getAcroForm()) return info
    fields = doc.getForm().getFields()
  } catch {
    return info
  }
  for (const field of fields) {
    if (field instanceof PDFButton || field instanceof PDFSignature) continue
    let name: string
    try {
      name = field.getName()
    } catch {
      continue
    }
    try {
      if (field instanceof PDFTextField) {
        info.values[name] = field.getText() ?? ''
        const dv = field.acroField.dict.lookup(PDFName.of('DV'))
        info.defaults[name] = dv instanceof PDFString || dv instanceof PDFHexString ? dv.decodeText() : ''
      } else if (field instanceof PDFCheckBox) {
        const on = field.acroField.getOnValue()
        info.values[name] = field.isChecked() ? (on?.decodeText() ?? 'Yes') : 'Off'
        info.defaults[name] = 'Off'
      } else if (field instanceof PDFRadioGroup) {
        info.values[name] = field.getSelected() ?? 'Off'
        info.defaults[name] = 'Off'
      } else if (field instanceof PDFDropdown) {
        info.values[name] = field.getSelected()[0] ?? ''
        info.defaults[name] = ''
      } else if (field instanceof PDFOptionList) {
        info.values[name] = field.getSelected()
        info.defaults[name] = []
      } else {
        continue
      }
      info.hasFields = true
    } catch {
      /* malformed field */
    }
  }
  return info
}
