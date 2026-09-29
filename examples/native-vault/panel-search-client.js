/** The search under a panel's title: one toggle, one input, Escape closes and clears. */
export function createPanelSearch(React, { IconButton }) {
  const h = React.createElement, { useState } = React;
  function usePanelSearch() {
    const [open, setOpen] = useState(false), [query, setQuery] = useState('');
    const close = () => { setOpen(false); setQuery(''); };
    return { open, query, setQuery, close, toggle: () => (open ? close() : setOpen(true)) };
  }
  const SearchButton = ({ search }) => h(IconButton, { icon: 'search', label: '搜索', 'aria-pressed': search.open, onClick: search.toggle });
  const SearchInput = ({ search, label, placeholder }) => search.open && h('input', {
    className: 'nv-panel-search', type: 'search', 'aria-label': label, placeholder, autoFocus: true, value: search.query,
    onChange: event => search.setQuery(event.target.value),
    onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); search.close(); } },
  });
  return { usePanelSearch, SearchButton, SearchInput };
}
