import { describe, expect, it } from 'vitest'
import { defaultPrefix, outputFileName, outputName, sanitizePrefix, splitFileName, typedPrefix, zipName } from './names.ts'

describe('file names with the output size', () => {
  it('outputFileName adds the size and the right extension', () => {
    expect(outputFileName('beach sunset.jpeg', 'image/jpeg', 1280, 960)).toBe('beach sunset-1280x960.jpg')
    expect(outputFileName('logo.PNG', 'image/webp', 64, 64)).toBe('logo-64x64.webp')
    expect(outputFileName('archive.tar.png', 'image/png', 10, 20)).toBe('archive.tar-10x20.png')
    expect(outputFileName('.png', 'image/png', 1, 1)).toBe('image-1x1.png')
  })
})

describe('splitFileName', () => {
  it('numbers the photos of a split collage, with the output extension', () => {
    expect(splitFileName('maroon lookbook.jpg', 'image/jpeg', 2)).toBe('maroon lookbook-2.jpg')
    expect(splitFileName('collage.final.PNG', 'image/webp', 10)).toBe('collage.final-10.webp')
    expect(splitFileName('.png', 'image/png', 1)).toBe('image-1.png')
  })
})

describe('file name prefix', () => {
  it.each([
    ['Maroon Striped Activewear Lookbook', 'Maroon-Striped-Activewear-Lookbook'],
    ['  summer  sale!! 2026 ', 'summer-sale-2026'],
    ['a__b--c', 'a_b-c'],
    ['--_kurti_--', 'kurti'],
    ['कुर्ता सेट', 'कुर्ता-सेट'], // Devanagari with vowel signs (combining marks) stays intact
    ['夏季 连衣裙', '夏季-连衣裙'],
    ['Größe/Été', 'Größe-Été'],
    ['', 'image'],
    ['!!!', 'image'],
    ['x'.repeat(80), 'x'.repeat(60)],
  ])('%j → %j', (input, expected) => expect(sanitizePrefix(input)).toBe(expected))
  it('while typing, a trailing "-" is kept so the next letter can follow', () => {
    expect(typedPrefix('red ')).toBe('red-')
    expect(typedPrefix('red--')).toBe('red-')
  })
  it('the default is the original file name without the extension', () => {
    expect(defaultPrefix('Olive Activewear Adventures by the Sea.jpg')).toBe('Olive-Activewear-Adventures-by-the-Sea')
    expect(defaultPrefix('1792069440411285.JPG')).toBe('1792069440411285')
  })
  it('names: <prefix>-<k>.<ext>, and the ZIP <prefix>.zip', () => {
    expect(outputName('kurti set', 2, 'image/jpeg')).toBe('kurti-set-2.jpg')
    expect(outputName('', 1, 'image/webp')).toBe('image-1.webp')
    expect(zipName('kurti set ')).toBe('kurti-set.zip')
  })
})
