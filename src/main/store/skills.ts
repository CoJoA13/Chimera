import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const MAX_SKILLS = 100
const MAX_SKILL_BYTES = 16 * 1024

/**
 * The distilled-skills plugin: a Claude Code plugin folder that agents write
 * SKILL.md files into. Loaded into every Claude session alongside user plugins,
 * so successful techniques compound over time.
 */
export function distilledPluginPath(): string {
  const root = join(app.getPath('userData'), 'distilled-skills')
  const manifestDir = join(root, '.claude-plugin')
  if (!existsSync(manifestDir)) {
    mkdirSync(manifestDir, { recursive: true })
    writeFileSync(
      join(manifestDir, 'plugin.json'),
      JSON.stringify(
        { name: 'distilled', description: 'Skills distilled by Chimera agents', version: '1.0.0' },
        null,
        2
      )
    )
    mkdirSync(join(root, 'skills'), { recursive: true })
  }
  return root
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

export function saveSkill(name: string, description: string, instructions: string): string {
  const slug = slugify(name)
  if (!slug) throw new Error('Skill name must contain letters or digits')
  const body = `---\nname: ${slug}\ndescription: ${description.replaceAll('\n', ' ').slice(0, 300)}\n---\n\n${instructions}`
  if (body.length > MAX_SKILL_BYTES) {
    throw new Error(`Skill too large (${body.length} bytes, cap ${MAX_SKILL_BYTES}). Condense it.`)
  }
  const skillsDir = join(distilledPluginPath(), 'skills')
  const existing = readdirSync(skillsDir)
  if (!existing.includes(slug) && existing.length >= MAX_SKILLS) {
    throw new Error(`Skill library full (${MAX_SKILLS}). Delete stale skills first.`)
  }
  const dir = join(skillsDir, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
  return slug
}

export function listSkills(): { slug: string }[] {
  const skillsDir = join(distilledPluginPath(), 'skills')
  if (!existsSync(skillsDir)) return []
  return readdirSync(skillsDir).map((slug) => ({ slug }))
}

export function deleteSkill(slug: string): void {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Bad slug')
  rmSync(join(distilledPluginPath(), 'skills', slug), { recursive: true, force: true })
}
