import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

let serverPromise

async function getServer() {
  if (!serverPromise) {
    serverPromise = import(join(__dirname, '..', 'app', 'dist', 'server', 'server.js'))
  }
  return serverPromise
}

export default async function handler(req, res) {
  try {
    const serverModule = await getServer()
    const server = serverModule.default
    
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`)
    
    const fetchRequest = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined
    })
    
    const response = await server.fetch(fetchRequest)
    
    res.status(response.status)
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })
    
    const body = await response.text()
    res.send(body)
  } catch (error) {
    console.error('Error handling request:', error)
    res.status(500).send('Internal Server Error')
  }
}