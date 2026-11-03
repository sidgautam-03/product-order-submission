import { setupServer } from 'msw/node'

export const BASE = 'http://localhost:3000'
export const server = setupServer()
