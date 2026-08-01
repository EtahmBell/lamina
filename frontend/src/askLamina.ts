export const ASK_LAMINA_UNSUPPORTED =
  'Lamina can currently help you ask the physician network, review grounded responses, and search published discussions. Referral and draft-revision workflows are not available yet.'

export const OPEN_PATIENT_FOR_NETWORK_QUESTION =
  'Open a patient first to ask the physician network about this case.'

export function isReferralRequest(request: string): boolean {
  return /\b(refer|referral)\b/i.test(request)
}

export function isNetworkQuestionRequest(request: string): boolean {
  return /\b(ask|question|network|seen|similar|case|specialist|endocrin)/i.test(request)
}

export function isPatientNetworkQuestionRequest(request: string): boolean {
  return /\b(has anyone seen|ask the (?:physician )?network|make a question about (?:this|the) case)\b/i.test(request)
}

export function networkSearchTerms(request: string): string {
  const simplified = request
    .replace(/^\s*(find|search(?:\s+for)?)\s+(published\s+)?(discussions?|posts?|threads?)\s+(about|on|for)\s+/i, '')
    .replace(/[?.!]+$/g, '')
    .trim()
  return simplified.length >= 2 ? simplified : request.trim()
}
