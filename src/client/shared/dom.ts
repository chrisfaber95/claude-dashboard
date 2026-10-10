/** The element with this id, typed as `T`; the id must exist in the page. */
export const elementById = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
