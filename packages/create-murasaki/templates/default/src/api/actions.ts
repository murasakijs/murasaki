'use server'
import { defineAction } from 'murasaki'

export const greet = defineAction(async (name: string) => {
  return `Hello, ${name}! (from Node ${process.version})`
})
