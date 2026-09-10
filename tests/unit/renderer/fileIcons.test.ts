import { describe, it, expect } from 'vitest'
import { fileIconFor } from '@renderer/ui/sidebar/iconSpec'

describe('fileIconFor', () => {
  it('maps known extensions to badges, images to the image icon, others to generic', () => {
    expect(fileIconFor('a.ts')).toMatchObject({ kind: 'badge', label: 'TS' })
    expect(fileIconFor('/x/y/App.res')).toMatchObject({ kind: 'badge', label: 'RE' })
    expect(fileIconFor('deps.edn')).toMatchObject({ kind: 'badge', label: 'EDN' })
    expect(fileIconFor('README.MD')).toMatchObject({ kind: 'badge', label: 'MD' })
    expect(fileIconFor('shot.PNG')).toEqual({ kind: 'image' })
    expect(fileIconFor('Makefile')).toEqual({ kind: 'generic' })
    expect(fileIconFor('.gitignore')).toEqual({ kind: 'generic' })
    expect(fileIconFor('.eslintrc.json')).toMatchObject({ kind: 'badge', label: '{ }' })
  })
})
