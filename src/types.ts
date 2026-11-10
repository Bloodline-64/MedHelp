export type ScanMode = 'auto' | 'text' | 'injury' | 'object' | 'medicine' | 'document'

export type ScanKind = 'injury' | 'text' | 'document' | 'medicine' | 'object' | 'plant' | 'food' | 'other'

export type Urgency = 'emergency' | 'urgent' | 'soon' | 'self-care' | 'unknown'

export type Confidence = 'high' | 'medium' | 'low'

export interface ScanResult {
  id: string
  at: number
  mode: ScanMode
  kind: ScanKind
  title: string
  transcription: string
  summary: string
  findings: string[]
  advice: string[]
  redFlags: string[]
  urgency: Urgency
  confidence: Confidence
  followUpQuestions: string[]
  model: string
}

export const SCAN_MODES: Array<{
  id: ScanMode
  label: string
  short: string
  description: string
  icon: string
  tint: string
}> = [
  {
    id: 'auto',
    label: 'Smart scan',
    short: 'Auto',
    description: 'Detects what it is and gives the right help',
    icon: 'spark',
    tint: 'teal',
  },
  {
    id: 'injury',
    label: 'Injury / skin',
    short: 'Injury',
    description: 'First aid, warning signs, when to get care',
    icon: 'heart',
    tint: 'rose',
  },
  {
    id: 'text',
    label: 'Text & reading',
    short: 'Text',
    description: 'Transcribe, explain and act on any text',
    icon: 'text',
    tint: 'blue',
  },
  {
    id: 'document',
    label: 'Document',
    short: 'Document',
    description: 'Letters, bills, forms, dates and deadlines',
    icon: 'doc',
    tint: 'violet',
  },
  {
    id: 'medicine',
    label: 'Medicine label',
    short: 'Medicine',
    description: 'Read the label, dose and safety warnings',
    icon: 'pill',
    tint: 'amber',
  },
  {
    id: 'object',
    label: 'Object / plant / food',
    short: 'Object',
    description: 'Identify it and flag anything unsafe',
    icon: 'leaf',
    tint: 'green',
  },
]

export function modeLabel(mode: ScanMode): string {
  return SCAN_MODES.find((entry) => entry.id === mode)?.short ?? 'Scan'
}

export const URGENCY_LABEL: Record<Urgency, string> = {
  emergency: 'Emergency — get help now',
  urgent: 'Urgent — seek care today',
  soon: 'See a professional soon',
  'self-care': 'Likely safe to manage at home',
  unknown: 'Not enough information to judge',
}

export function disclaimerFor(result: Pick<ScanResult, 'kind'>): string {
  switch (result.kind) {
    case 'injury':
      return 'This is general first-aid information, not a medical diagnosis. If bleeding is heavy or will not stop, the person is faint, confused or struggling to breathe, or the wound is deep, gaping or from an animal bite, call emergency services now.'
    case 'medicine':
      return 'Medicines are easy to misread. Always check the printed label and ask a pharmacist or doctor before taking, stopping or changing any medicine. Never change a dose based on this result.'
    case 'plant':
    case 'food':
    case 'object':
      return 'Photo identification can be wrong. Do not eat a plant, mushroom or food, and do not handle an unknown object, based on this result alone. When in doubt, leave it alone.'
    case 'text':
    case 'document':
      return 'AI can misread text. Check important names, amounts, dates and deadlines against the original document before acting.'
    default:
      return 'This is AI-generated guidance and may be incomplete or wrong. Use your own judgement and ask a qualified person when it matters.'
  }
}

export function kindLabel(kind: ScanKind): string {
  const map: Record<ScanKind, string> = {
    injury: 'Injury / skin',
    text: 'Text',
    document: 'Document',
    medicine: 'Medicine',
    object: 'Object',
    plant: 'Plant',
    food: 'Food',
    other: 'Scan',
  }
  return map[kind]
}
