import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
  	extend: {
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			/* E0 — el token semántico de aviso. Sin `hsl(...)` alrededor porque su
  			   variable ya es un color completo, no un triplete: ver el porqué en
  			   globals.css, junto a la declaración. */
  			/* ── E4b · LAS ESCALAS SEMÁNTICAS ────────────────────────────────────
  			   Seis roles por intención. Ver el porqué en globals.css. */
  			warning: {
  				DEFAULT: 'var(--warning)',
  				surface: 'var(--warning-surface)',
  				border: 'var(--warning-border)',
  				foreground: 'var(--warning-foreground)',
  				solid: 'var(--warning-solid)',
  				'solid-hover': 'var(--warning-solid-hover)'
  			},
  			success: {
  				DEFAULT: 'var(--success)',
  				surface: 'var(--success-surface)',
  				border: 'var(--success-border)',
  				foreground: 'var(--success-foreground)',
  				solid: 'var(--success-solid)',
  				'solid-hover': 'var(--success-solid-hover)'
  			},
  			info: {
  				DEFAULT: 'var(--info)',
  				surface: 'var(--info-surface)',
  				border: 'var(--info-border)',
  				foreground: 'var(--info-foreground)'
  			},
  			/* `destructive` ya existía (shadcn): es el relleno macizo. Gana su
  			   superficie suave con nombre propio — ver globals.css. */
  			'destructive-subtle': 'var(--destructive-subtle)',
  			'destructive-border': 'var(--destructive-border)',
  			'destructive-strong': 'var(--destructive-strong)',
  			pending: {
  				surface: 'var(--pending-surface)',
  				foreground: 'var(--pending-foreground)'
  			},
  			neutral: {
  				surface: 'var(--neutral-surface)',
  				foreground: 'var(--neutral-foreground)',
  				solid: 'var(--neutral-solid)',
  				'solid-hover': 'var(--neutral-solid-hover)'
  			},
  			/* E2 — las convenciones. No son estados: ver el porqué en globals.css. */
  			rating: 'var(--rating)',
  			featured: 'var(--featured)',
  			favorite: 'var(--favorite)'
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		/* ── E3 · LOS EJES NO-COLOR (capa T3) ─────────────────────────────────
  		   Cada uno apunta a su variable de globals.css, y cada variable vale hoy
  		   exactamente lo que valía antes de existir. Ver el bloque T3 allí. */
  		fontFamily: {
  			/* El preflight de Tailwind ya pone `font-family: theme('fontFamily.sans')`
  			   en el <html>, así que con declararlo aquí la fuente llega a todo el
  			   documento: por eso el <body> pudo soltar la clase de `next/font`. */
  			sans: ['var(--font-sans)'],
  			heading: ['var(--font-heading)']
  		},
  		/* Al escribir la sombra como una variable, Tailwind ya no puede generar su
  		   variante «coloreada» (la que sustituye el color por `--tw-shadow-color`
  		   para `shadow-blue-500/50` y compañía). No afecta: en el repo no hay ni una
  		   sombra de color, verificado. Si algún día hiciera falta, el arreglo es
  		   declarar aparte los valores con el hueco del color, no volver atrás. */
  		boxShadow: {
  			sm: 'var(--shadow-sm)',
  			DEFAULT: 'var(--shadow)',
  			md: 'var(--shadow-md)',
  			lg: 'var(--shadow-lg)',
  			xl: 'var(--shadow-xl)'
  		},
  		transitionDuration: {
  			/* Sólo el DEFAULT: es el que usan las ~100 transiciones que no piden
  			   duración. Los `duration-200`/`duration-300` explícitos se quedan en la
  			   escala numérica, que es estructura y no personalidad. */
  			DEFAULT: 'var(--motion-duration)'
  		},
  		transitionTimingFunction: {
  			DEFAULT: 'var(--motion-ease)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  /**
   * E6 — VUELVE `tailwindcss-animate`, Y VUELVE ATADO AL SISTEMA.
   *
   * E0 quitó sus clases en vez de instalarlo, porque instalarlo habría añadido animación
   * donde no la había justo en la ráfaga que existía para demostrar que nada cambiaba
   * (§6.3 del diseño). Ahora entra como VOCABULARIO DEL MODELO.
   *
   * NO TRAE SUS PROPIOS TIEMPOS, y esto es lo que hace que sea del sistema y no un
   * cuerpo extraño: el plugin deriva su `animationDuration` de `transitionDuration`
   * (index.js:129-132, verificado en el paquete instalado), y ese DEFAULT lo fijó E3 a
   * `var(--motion-duration)`. Así que `animate-in` dura lo que dure el tempo del modelo
   * —y lo que cada ZONA ajuste: 150 ms en público, 120 en cuenta y blog, 100 en el
   * backoffice— sin una línea de pegamento.
   *
   * La curva sí hay que ponerla a mano: `.animate-in` no declara
   * `animation-timing-function`. Se declara en `globals.css`, con `var(--motion-ease)`.
   */
  plugins: [typography, animate],
};

export default config;
