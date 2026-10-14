import { FormInput, Info, Lock, Signature } from 'lucide-react'
import { useActiveDoc, useDocStore } from '../store/docStore'
import { useUi } from '../store/uiStore'

/** Thin contextual bar under the toolbar: forms, protection, image placement. */
export function InfoBar(): React.JSX.Element | null {
  const doc = useActiveDoc()
  const mode = useUi((s) => s.mode)
  const pending = useUi((s) => s.pendingImage)
  const tool = useUi((s) => s.tool)
  if (!doc || mode !== 'view') return null

  if (tool === 'image' && pending) {
    return (
      <div className="info-bar">
        <Signature size={15} />
        <span className="grow">
          Щёлкните на странице, чтобы разместить {pending.signature ? 'подпись' : 'изображение'}. Esc — отмена.
        </span>
        <button className="btn" onClick={() => useUi.getState().setTool('select')}>
          Отмена
        </button>
      </div>
    )
  }

  if (doc.encrypted) {
    return (
      <div className="info-bar warn">
        <Lock size={15} />
        <span className="grow">Документ зашифрован неподдерживаемым способом и открыт только для просмотра.</span>
      </div>
    )
  }

  if (doc.restricted) {
    return (
      <div className="info-bar warn">
        <Lock size={15} />
        <span className="grow">Владелец ограничил изменение этого документа.</span>
        <button className="btn" onClick={() => useUi.getState().setDialog({ kind: 'protect' })}>
          Ввести пароль владельца
        </button>
      </div>
    )
  }

  if (doc.form.hasFields) {
    return (
      <div className="info-bar">
        <FormInput size={15} />
        <span className="grow">Документ содержит поля формы, их можно заполнить.</span>
        <label className="check">
          <input
            type="checkbox"
            checked={doc.form.highlight}
            onChange={(e) => useDocStore.getState().setFormHighlight(doc.id, e.target.checked)}
          />
          Подсветить поля
        </label>
        <button className="btn" onClick={() => useDocStore.getState().resetForm(doc.id)}>
          Очистить форму
        </button>
      </div>
    )
  }

  if (doc.protection) {
    return (
      <div className="info-bar">
        <Info size={15} />
        <span className="grow">
          {doc.protection.userPassword ? 'Документ защищён паролем.' : 'Для документа заданы ограничения.'} Защита сохраняется при сохранении файла.
        </span>
        <button className="btn" onClick={() => useUi.getState().setDialog({ kind: 'protect' })}>
          Настроить
        </button>
      </div>
    )
  }
  return null
}
