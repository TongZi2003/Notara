/** The native Markdown package imports this stylesheet for its side effects. */
declare module 'katex/dist/katex.min.css' {}
/** The notebook theme imports its own stylesheet: tsc emits the import, the browser bundle loads it. */
declare module '*/notebook.css' {}
declare module '*/tool-activity.css' {}
declare module '*/original-shell.css' {}
declare module '*/original-pages.css' {}
