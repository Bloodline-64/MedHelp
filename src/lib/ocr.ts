export interface OcrProgress {
  status: string
  progress: number
}

export class OcrUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OcrUnavailableError'
  }
}

const CDN_SOURCES = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js',
]

interface TesseractGlobal {
  createWorker: (...args: unknown[]) => Promise<TesseractWorker>
}

type TesseractWorker = {
  recognize: (image: Blob) => Promise<{ data?: { text?: string } }>
}

let workerPromise: Promise<TesseractWorker> | null = null
let onProgress: ((progress: OcrProgress) => void) | null = null

function loadScript(url: string, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.crossOrigin = 'anonymous'
    const timer = window.setTimeout(() => {
      script.remove()
      reject(new Error('timeout'))
    }, timeoutMs)

    script.onload = () => {
      window.clearTimeout(timer)
      resolve()
    }
    script.onerror = () => {
      window.clearTimeout(timer)
      script.remove()
      reject(new Error('failed'))
    }

    document.head.appendChild(script)
  })
}

async function loadTesseract(): Promise<TesseractGlobal> {
  const scope = window as unknown as { Tesseract?: TesseractGlobal }
  if (scope.Tesseract?.createWorker) return scope.Tesseract

  for (const url of CDN_SOURCES) {
    try {
      await loadScript(url)
      if (scope.Tesseract?.createWorker) return scope.Tesseract
    } catch {
      // Try the next mirror.
    }
  }

  throw new OcrUnavailableError(
    'The offline OCR engine could not be downloaded. Check your connection, or paste the text instead.',
  )
}

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const tesseract = await loadTesseract()

      try {
        return await tesseract.createWorker('eng', 1, {
          logger: (message: { status?: string; progress?: number }) => {
            onProgress?.({
              status: typeof message?.status === 'string' ? message.status : 'working',
              progress: typeof message?.progress === 'number' ? message.progress : 0,
            })
          },
        })
      } catch {
        throw new OcrUnavailableError(
          'The English language pack could not be loaded. A connection is required for the first OCR scan.',
        )
      }
    })()
    workerPromise.catch(() => {
      workerPromise = null
    })
  }

  return workerPromise
}

export async function recognizeText(image: Blob, onUpdate: (progress: OcrProgress) => void): Promise<string> {
  onProgress = onUpdate
  const worker = await getWorker()
  onProgress = onUpdate
  onUpdate({ status: 'recognizing text', progress: 0 })

  try {
    const result = await worker.recognize(image)
    return (result?.data?.text ?? '').trim()
  } catch {
    throw new OcrUnavailableError('The scan failed while reading the image. Try a sharper, well-lit photo.')
  } finally {
    onProgress = null
  }
}

export function describeOcrStatus(status: string): string {
  const map: Record<string, string> = {
    'loading tesseract core': 'Loading vision core',
    'initializing tesseract': 'Starting engine',
    'loading language traineddata': 'Downloading language pack',
    'initializing api': 'Warming up',
    'recognizing text': 'Reading text',
  }
  return map[status] ?? status.replace(/^\w/, (letter) => letter.toUpperCase())
}
