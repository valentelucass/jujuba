import { useEffect, useState } from 'react'
import { appError, systemDiagram } from './api'
import type { AiProvider, AssistantModel, AssistantOptions } from '../models/systemDiagram'

const preference = (provider: AiProvider) => 'jujuba.assistant.' + provider + '.options'

function readOptions(provider: AiProvider): AssistantOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(preference(provider)) ?? 'null')
    if (typeof saved?.model === 'string' && saved.model) {
      return { model: saved.model, reasoningEffort: typeof saved.reasoningEffort === 'string' ? saved.reasoningEffort : undefined }
    }
  } catch { /* The provider defaults also work without browser storage. */ }
  return {}
}

type Catalog = { provider: AiProvider; models?: AssistantModel[]; error?: string }

export function useAssistantSettings(provider: AiProvider, open: boolean) {
  const [saved, setSaved] = useState(() => ({
    codex: readOptions('codex'), claude: readOptions('claude'), gemini: readOptions('gemini'),
  }))
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!open) return
    let active = true
    setCatalog(null)
    systemDiagram.models(provider).then((models) => {
      if (active) setCatalog({ provider, models })
    }).catch((failure) => {
      if (active) setCatalog({ provider, error: appError(failure).message })
    })
    return () => { active = false }
  }, [provider, open, refresh])

  function save(options: AssistantOptions) {
    setSaved((current) => ({ ...current, [provider]: options }))
    try {
      if (options.model) localStorage.setItem(preference(provider), JSON.stringify(options))
      else localStorage.removeItem(preference(provider))
    } catch { /* The selection still applies to the current session. */ }
  }

  const models = catalog?.provider === provider ? catalog.models : undefined
  const error = catalog?.provider === provider ? catalog.error : undefined
  const options = saved[provider].model ? saved[provider] : undefined
  const model = models?.find((item) => item.id === options?.model)
  let unavailable = ''
  if (models && options?.model && !model) unavailable = 'O modelo salvo saiu da lista. Escolha outro modelo no assistente.'
  else if (model && options?.reasoningEffort && !model.reasoningEfforts.includes(options.reasoningEffort)) {
    unavailable = 'O nível salvo saiu da lista do modelo. Escolha outro nível de raciocínio no assistente.'
  }

  function chooseModel(id: string) {
    const next = models?.find((item) => item.id === id)
    const effort = next?.defaultReasoningEffort
    save(next ? { model: next.id, reasoningEffort: effort && next.reasoningEfforts.includes(effort) ? effort : undefined } : {})
  }

  return {
    options, model, models, error, unavailable, chooseModel,
    chooseEffort: (effort: string) => save({ ...options, reasoningEffort: effort || undefined }),
    reload: () => setRefresh((value) => value + 1),
  }
}
