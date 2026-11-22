import type { BuilderNode, ComponentType } from './schema'

export const TEMPLATE_CATEGORIES = ['Business', 'Portfolio', 'Agency', 'SaaS', 'E-commerce', 'Education', 'Blog', 'Restaurant', 'Landing Page', 'Personal Website'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]
export type Template = { id: string; name: string; category: TemplateCategory; description: string; nodes: BuilderNode[] }

const n = (id: string, type: ComponentType, text: string, style: BuilderNode['style'] = {}, children: BuilderNode[] = []): BuilderNode => ({ id, type, props: { text }, style, children })
const hero = (name: string, category: TemplateCategory, description: string): BuilderNode[] => [
  n('nav', 'navbar', name, { padding: '1rem 2rem', display: 'flex', backgroundColor: '#ffffff' }, [n('nav-home', 'link', 'Home', { color: '#3f46a5' }), n('nav-about', 'link', 'About'), n('nav-contact', 'link', 'Contact')]),
  n('hero', 'hero', category === 'Portfolio' ? 'Ideas, made visible.' : 'Build something remarkable.', { padding: '6rem 2rem', textAlign: 'center', backgroundColor: '#f2f3ff', borderRadius: '1rem' }, [
    n('hero-copy', 'paragraph', description, { fontSize: '1.1rem', maxWidth: '42rem', margin: '1rem auto' }),
    n('hero-button', 'button', 'Explore more', { backgroundColor: '#5658db', color: '#ffffff', padding: '0.8rem 1.3rem', borderRadius: '0.7rem' }),
  ]),
  n('features', 'features', 'Designed to move you forward', { padding: '3rem 1rem' }, [
    n('feature-1', 'card', 'Thoughtful by design', { padding: '1.5rem', backgroundColor: '#ffffff', borderRadius: '1rem', boxShadow: '0 8px 24px rgba(28, 32, 66, .08)' }, [n('feature-1-copy', 'paragraph', 'A clear, focused experience that puts your goals first.')]),
    n('feature-2', 'card', 'Made for momentum', { padding: '1.5rem', backgroundColor: '#ffffff', borderRadius: '1rem', boxShadow: '0 8px 24px rgba(28, 32, 66, .08)' }, [n('feature-2-copy', 'paragraph', 'Simple tools help you turn your next idea into action.')]),
    n('feature-3', 'card', 'Ready to grow', { padding: '1.5rem', backgroundColor: '#ffffff', borderRadius: '1rem', boxShadow: '0 8px 24px rgba(28, 32, 66, .08)' }, [n('feature-3-copy', 'paragraph', 'Flexible foundations that look great on every screen.')]),
  ]),
  n('cta', 'cta', 'Your next chapter starts here', { padding: '3rem 2rem', textAlign: 'center', backgroundColor: '#222443', color: '#ffffff', borderRadius: '1rem' }, [n('cta-button', 'button', 'Let’s talk', { backgroundColor: '#7778ef', color: '#ffffff', padding: '0.75rem 1.1rem', borderRadius: '0.7rem' })]),
  n('footer', 'footer', `${name} · Built with care`, { padding: '2rem', color: '#6b7280', textAlign: 'center' }),
]

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank canvas', category: 'Landing Page', description: 'Start with a clean page.', nodes: [] },
  { id: 'business', name: 'Northstar Studio', category: 'Business', description: 'A polished services site for a modern business.', nodes: hero('Northstar Studio', 'Business', 'We help ambitious teams do their best work.') },
  { id: 'portfolio', name: 'Made by You', category: 'Portfolio', description: 'A focused portfolio for your best work.', nodes: hero('Made by You', 'Portfolio', 'A curated collection of selected work and creative thinking.') },
  { id: 'agency', name: 'Kindred Creative', category: 'Agency', description: 'A confident home for a creative agency.', nodes: hero('Kindred Creative', 'Agency', 'Strategy, identity and digital experiences for people-first brands.') },
  { id: 'saas', name: 'Orbit SaaS', category: 'SaaS', description: 'A concise product landing page.', nodes: hero('Orbit', 'SaaS', 'Bring your team’s work into one calmer, clearer place.') },
  { id: 'ecommerce', name: 'Common Goods', category: 'E-commerce', description: 'A simple storefront introduction.', nodes: hero('Common Goods', 'E-commerce', 'Useful everyday objects, thoughtfully made.') },
  { id: 'education', name: 'Open Learning', category: 'Education', description: 'A welcoming education website.', nodes: hero('Open Learning', 'Education', 'Curiosity can take you anywhere. Start learning today.') },
  { id: 'blog', name: 'Field Notes', category: 'Blog', description: 'A minimal editorial start page.', nodes: hero('Field Notes', 'Blog', 'Ideas, observations and stories worth sharing.') },
  { id: 'restaurant', name: 'Saffron Table', category: 'Restaurant', description: 'A warm restaurant introduction.', nodes: hero('Saffron Table', 'Restaurant', 'Seasonal cooking, generous tables and a little spice.') },
  { id: 'personal', name: 'Hello, I’m Alex', category: 'Personal Website', description: 'A personal home page to introduce yourself.', nodes: hero('Hello, I’m Alex', 'Personal Website', 'Designer, maker and curious human based in the city.') },
]

export function templateById(id: string): Template {
  return TEMPLATES.find((template) => template.id === id) ?? TEMPLATES[0]!
}
