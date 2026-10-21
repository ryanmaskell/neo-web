'use strict';

// MENUS: the desktop's menu bar, as a template. main.js hands it to
// Electron (buildMenu); NEO on the web shows the same menus behind its ⋯
// button (web/web-menu.js). Plain JavaScript that runs in both: everything
// it needs comes in through `c`:
//
//   c = {
//     t, isMac, isWin,
//     send(msg),                 the window's own message ({ type, ... })
//     pageKey(accelerator, run), a key the page answers itself (main.js)
//     st: { script, view, pages, pageWidth, typewriter, nbspMarks, flush,
//           poetry, vim, uiZoom, uiLanguage, writingStyle, more, bookOpen,
//           spellLanguage },     the ticks, as the window last reported them
//     spellLanguages: { code: { label } }, languages: [{ code, name }],
//     library(),                 library.json, for the two settings kept there
//     actions: { libraryFolder, fullScreen, setLanguage(code) }
//   }
//
// Items marked `more: true` are behind File → Show More Features
// (simpleTemplate leaves them out).

(function (root) {
  // a template without the `more` items, and without the separators they leave
  // at an end or side by side
  function simpleTemplate(items, more) {
    const kept = items.filter((it) => more || !it.more).map((it) => {
      const { more: _, ...item } = it;
      return Array.isArray(item.submenu) ? { ...item, submenu: simpleTemplate(item.submenu, more) } : item;
    });
    const shown = (it) => it.visible !== false;
    return kept.filter((it, i) => {
      if (it.type !== 'separator' || !shown(it)) return true;
      const before = kept.slice(0, i).filter(shown).pop();
      const after = kept.slice(i + 1).find(shown);
      return !!before && !!after && before.type !== 'separator';
    });
  }

  function menuTemplate(c) {
    const { t, isMac, isWin, send, pageKey, st } = c;
    // macOS and Windows name faces that ship with the OS. Linux has none of
    // them, so the menu names the faces bundled in fonts/ (see styles.css).
    // The Windows list stays the one the renderer already understands.
    const bodyFonts = isMac
      ? ['Georgia', 'Palatino', 'Baskerville', 'Hoefler Text', 'Iowan Old Style', 'Jost', 'iA Writer Quattro']
      : isWin
        ? ['Georgia', 'Palatino', 'Baskerville', 'Cambria', 'Constantia', 'Jost', 'iA Writer Quattro']
        : ['Gelasio', 'TeX Gyre Pagella', 'Libre Baskerville', 'Alegreya', 'Source Serif Pro', 'Jost', 'iA Writer Quattro'];
    return [
      // appMenu exists only on macOS — including it on Windows throws,
      // which is exactly what kept NEO from ever opening a window there
      ...(isMac ? [{
        role: 'appMenu',
        submenu: [
          { role: 'about', label: t('About NEO') },
          { type: 'separator' },
          { role: 'services', label: t('Services') },
          { type: 'separator' },
          { role: 'hide', label: t('Hide NEO') },
          { role: 'hideOthers', label: t('Hide Others') },
          { role: 'unhide', label: t('Show All') },
          { type: 'separator' },
          { role: 'quit', label: t('Quit NEO') }
        ]
      }] : []),
      {
        label: t('File'),
        submenu: [
          {
            label: t('Export'),
            submenu: st.script.on ? [
              { label: 'PDF (.pdf)', click: () => send({ type: 'export', format: 'pdf' }) },
              { label: 'Fountain (.fountain)', click: () => send({ type: 'export', format: 'fountain' }) },
              { label: 'Final Draft (.fdx)', click: () => send({ type: 'export', format: 'fdx' }) }
            ] : [
              { more: true, label: t('Plain Text (.txt)'), click: () => send({ type: 'export', format: 'txt' }) },
              { more: true, label: 'Markdown (.md)', click: () => send({ type: 'export', format: 'md' }) },
              { more: true, label: t('Web Page (.html)'), click: () => send({ type: 'export', format: 'html' }) },
              { label: 'PDF (.pdf)', click: () => send({ type: 'export', format: 'pdf' }) },
              { label: 'Word (.docx)', click: () => send({ type: 'export', format: 'docx' }) },
              { label: 'EPUB (.epub)', click: () => send({ type: 'export', format: 'epub' }) },
              { type: 'separator' },
              { label: t('Paperback for KDP…'), click: () => send({ type: 'export', format: 'paperback' }) },
              { more: true, label: t('Manuscript Format…'), click: () => send({ type: 'export', format: 'manuscript' }) },
              { type: 'separator' },
              {
                more: true,
                id: 'export-custom-chapter-titles',
                label: t('Chapter Titles Only'),
                type: 'checkbox',
                checked: !!c.library().exportCustomChapterTitles,
                click: (item) => send({ type: 'exportCustomChapterTitles', checked: item.checked })
              }
            ]
          },
          { type: 'separator' },
          {
            label: t('Email Draft to Myself'),
            accelerator: 'CmdOrCtrl+E',
            click: () => send({ type: 'emailDraft' })
          },
          { label: t('Email Settings…'), click: () => send({ type: 'emailSettings' }) },
          { type: 'separator' },
          // shown, not registered: the window answers ⌘S itself, so it works the
          // same in Pocket with a keyboard and never fires twice
          { label: t('Take Snapshot'), accelerator: 'CmdOrCtrl+S', registerAccelerator: false, click: () => send({ type: 'snapshot' }) },
          { type: 'separator' },
          { more: true, label: t('Cover Art…'), click: () => send({ type: 'coverArt' }) },
          {
            label: t('Goals…'),
            accelerator: 'CmdOrCtrl+,',
            click: () => send({ type: 'stats' })
          },
          {
            more: true,
            label: t('New Books Open To'),
            submenu: [
              { label: t('Blank Page'), type: 'radio', checked: st.writingStyle !== 'plotter', click: () => send({ type: 'st.writingStyle', value: 'pantser' }) },
              { label: t('Outline First'), type: 'radio', checked: st.writingStyle === 'plotter', click: () => send({ type: 'st.writingStyle', value: 'plotter' }) }
            ]
          },
          { type: 'separator' },
          {
            label: t('Import Manuscripts…'),
            accelerator: 'CmdOrCtrl+Shift+I',
            click: () => send({ type: 'import' })
          },
          {
            more: true,
            label: t('Import Chapters…'),
            enabled: st.bookOpen && !st.script.on,
            click: () => send({ type: 'importChapters' })
          },
          { more: true, label: t('Reshelve a Book…'), click: () => send({ type: 'reshelve' }) },
          { label: t('Library Folder…'), click: () => c.actions.libraryFolder() },
          { type: 'separator' },
          {
            label: t('Show More Features'),
            type: 'checkbox',
            checked: st.more,
            click: (item) => send({ type: 'moreFeatures', checked: item.checked })
          },
          { type: 'separator' },
          ...(isMac ? [{ role: 'close', label: t('Close Window') }] : [{ role: 'quit', label: t('Quit') }])
        ]
      },
      {
        // macOS slips Writing Tools and AutoFill into this menu on its own;
        // hideSystemEditItems() hides them again (see below)
        label: t('Edit'),
        submenu: [
          // standard items carry their own labels, so they follow NEO's language
          { role: 'undo', label: t('Undo') }, { role: 'redo', label: t('Redo') },
          { type: 'separator' },
          { role: 'cut', label: t('Cut') }, { role: 'copy', label: t('Copy') }, { role: 'paste', label: t('Paste') },
          { role: 'pasteAndMatchStyle', label: t('Paste and Match Style') }, { role: 'selectAll', label: t('Select All') },
          { type: 'separator' },
          {
            label: isMac ? t('Find & Replace') : t('Find & Replace').replace(/&/g, '&&'),
            accelerator: 'CmdOrCtrl+F',
            click: () => send({ type: 'find' })
          },
          {
            label: t('Spellcheck Pass'),
            accelerator: 'CmdOrCtrl+;',
            // shown, not registered: the window answers the ; character itself
            // (isSpellcheckShortcut). Windows matches an accelerator by key
            // position, so on some layouts this one and ⌘/ landed on the same
            // key and one press did both (#282).
            registerAccelerator: false,
            click: () => send({ type: 'spellcheck' })
          },
          {
            more: true,
            label: t('Spellcheck Language'),
            submenu: Object.entries(c.spellLanguages).map(([code, lang]) => ({
              label: lang.label,
              type: 'radio',
              checked: st.spellLanguage === code,
              click: () => send({ type: 'st.spellLanguage', value: code })
            }))
          }
        ]
      },
      {
        label: t('Format'),
        submenu: [
          {
            visible: !st.script.on, // a script is set in Courier Prime
            label: t('Body Font'),
            submenu: [
              // A font the writer picked from their own computer is not in the list, and a radio
              // group with nothing checked shows the first built-in as chosen. Show the font in use
              // (#295).
              ...(st.view.bodyFont && !bodyFonts.includes(st.view.bodyFont)
                ? [{
                    label: st.view.bodyFont,
                    type: 'radio',
                    checked: true,
                    click: () => send({ type: 'bodyFont', value: st.view.bodyFont })
                  }]
                : []),
              ...bodyFonts.map((f) => ({
                label: f,
                type: 'radio',
                checked: st.view.bodyFont === f,
                click: () => send({ type: 'bodyFont', value: f })
              })),
              { type: 'separator' },
              { more: true, label: t('Other Font…'), click: () => send({ type: 'bodyFontPick' }) }
            ]
          },
          {
            visible: !st.script.on,
            label: t('Drop Cap Style'),
            submenu: [
              { label: t('Literary'), type: 'radio', checked: st.view.dropCap === 'literary', click: () => send({ type: 'dropCap', value: 'literary' }) },
              { label: t('Fantasy'), type: 'radio', checked: st.view.dropCap === 'fantasy', click: () => send({ type: 'dropCap', value: 'fantasy' }) },
              { label: t('Sci-Fi'), type: 'radio', checked: st.view.dropCap === 'scifi', click: () => send({ type: 'dropCap', value: 'scifi' }) },
              { type: 'separator' },
              { label: t('Off'), type: 'radio', checked: st.view.dropCap === 'none', click: () => send({ type: 'dropCap', value: 'none' }) }
            ]
          },
          {
            more: true,
            visible: !st.script.on, // a script's elements are placed where they print
            label: t('Align Paragraph'),
            submenu: [
              { label: t('Left'), accelerator: 'CmdOrCtrl+Shift+L', type: 'radio', checked: st.view.align === 'left', click: () => send({ type: 'align', value: 'left' }) },
              { label: t('Center'), accelerator: 'CmdOrCtrl+Shift+C', type: 'radio', checked: st.view.align === 'center', click: () => send({ type: 'align', value: 'center' }) },
              { label: t('Right'), accelerator: 'CmdOrCtrl+Shift+R', type: 'radio', checked: st.view.align === 'right', click: () => send({ type: 'align', value: 'right' }) },
              { label: t('Justify'), accelerator: 'CmdOrCtrl+Shift+J', type: 'radio', checked: st.view.align === 'justify', click: () => send({ type: 'align', value: 'justify' }) }
            ]
          },
          { type: 'separator' },
          { label: t('Larger Text'), accelerator: 'CmdOrCtrl-Plus', click: () => send({ type: 'fontSize', value: 1 }) },
          { label: t('Smaller Text'), accelerator: 'CmdOrCtrl-Minus', click: () => send({ type: 'fontSize', value: -1 }) },
          { label: t('Reset Text Size'), accelerator: 'CmdOrCtrl+0', click: () => send({ type: 'fontSize', value: 0 }) },
          { type: 'separator', visible: !st.script.on },
          {
            more: true,
            visible: !st.script.on, // a script has its own pages
            label: t('Show Pages'),
            type: 'checkbox',
            checked: st.pages.paged,
            click: () => send({ type: 'pagedView' })
          },
          {
            more: true,
            visible: !st.script.on,
            label: t('Two Pages Side by Side'),
            type: 'checkbox',
            checked: st.pages.twoUp,
            enabled: st.pages.paged, // greyed out until the pages are shown
            click: () => send({ type: 'twoPageView' })
          },
          {
            more: true,
            visible: !st.script.on, // a script is set to its own page
            label: t('Page Width'),
            submenu: [['regular', t('Regular')], ['wide', t('Wide')], ['wider', t('Wider')]].map(([value, label]) => ({
              label,
              type: 'radio',
              checked: st.pageWidth === value,
              click: () => send({ type: 'pageWidth', value })
            }))
          },
          { type: 'separator' },
          {
            label: t('Typewriter Scrolling'),
            accelerator: 'CmdOrCtrl+Shift+T',
            type: 'checkbox',
            checked: st.typewriter,
            click: () => send({ type: 'typewriter' })
          },
          {
            more: true,
            label: t('Non-Breaking Marks'),
            type: 'checkbox',
            checked: st.nbspMarks,
            click: () => send({ type: 'nbspMarks' })
          },
          { type: 'separator' },
          // tick when the caret sits in one; the keys are the editor's own
          // (they split or continue a paragraph, which a menu item can't), so
          // they're shown, not registered (pageKey)
          // a script's elements stand where a book's paragraph kinds do
          ...(st.script.on ? [
            [t('Scene Heading'), 'heading'], [t('Action'), 'action'], [t('Character'), 'character'], [t('Parenthetical'), 'paren'],
            [t('Dialogue'), 'dialogue'], [t('Transition'), 'transition'], [t('Shot'), 'shot']
          ].map(([label, value], i) => ({
            label,
            ...pageKey('CmdOrCtrl+' + (i + 1), () => send({ type: 'scriptElement', value })),
            type: 'radio',
            checked: st.script.element === value
          })) : []),
          // the script's own style, kept with that script
          ...(st.script.on ? [
            { type: 'separator' },
            { label: t('Underline Scene Headings'), type: 'checkbox', checked: st.script.underline, click: () => send({ type: 'scriptStyle', value: 'underline' }) },
            { label: t('(CONT\'D) for a Returning Speaker'), type: 'checkbox', checked: st.script.contd, click: () => send({ type: 'scriptStyle', value: 'contd' }) }
          ] : []),
          {
            visible: !st.script.on,
            label: t('Flush Paragraph'),
            ...pageKey('Shift+Enter', () => send({ type: 'flush' })),
            type: 'checkbox',
            checked: st.flush
          },
          {
            more: true,
            visible: !st.script.on,
            label: t('Poetry Paragraph'),
            ...pageKey('CmdOrCtrl+Shift+Enter', () => send({ type: 'poetry' })),
            type: 'checkbox',
            checked: st.poetry
          },
          { type: 'separator' },
          // *italic* and **bold** as you type or paste; off for writers who
          // keep literal asterisks
          {
            more: true,
            label: t('Markdown Emphasis'),
            type: 'checkbox',
            checked: !c.library().markdownOff,
            click: (item) => send({ type: 'markdownEmphasis', checked: item.checked })
          }
        ]
      },
      {
        label: t('View'),
        submenu: [
          {
            label: t('Keyboard Shortcuts…'),
            accelerator: 'CmdOrCtrl+/',
            registerAccelerator: false, // the window answers / and ? itself (isHelpShortcut)
            click: () => send({ type: 'help' })
          },
          { type: 'separator' },
          {
            label: t('Full Screen'),
            accelerator: 'CmdOrCtrl+Shift+F',
            click: () => c.actions.fullScreen()
          },
          {
            more: true,
            label: t('Focus Mode'),
            submenu: [
              { label: t('Cycle'), accelerator: 'CmdOrCtrl+Shift+O', click: () => send({ type: 'focusCycle' }) },
              { type: 'separator' },
              { label: t('Sentence'), type: 'radio', checked: st.view.focus === 'sentence', click: () => send({ type: 'focus', value: 'sentence' }) },
              { label: t('Paragraph'), type: 'radio', checked: st.view.focus === 'paragraph', click: () => send({ type: 'focus', value: 'paragraph' }) },
              { label: t('Off'), type: 'radio', checked: st.view.focus === 'off', click: () => send({ type: 'focus', value: 'off' }) }
            ]
          },
          {
            more: true,
            label: t('Vim Keys'),
            type: 'checkbox',
            checked: st.vim,
            click: () => send({ type: 'vim' })
          },
          { type: 'separator' },
          {
            label: t('Page'),
            submenu: [
              { label: t('Night'), type: 'radio', checked: st.view.pageTheme !== 'paper' && st.view.pageTheme !== 'light', click: () => send({ type: 'pageTheme', value: 'night' }) },
              { label: t('Paper'), type: 'radio', checked: st.view.pageTheme === 'paper', click: () => send({ type: 'pageTheme', value: 'paper' }) },
              // white paper in a light room: the whole app, shelf included
              { label: t('Light'), type: 'radio', checked: st.view.pageTheme === 'light', click: () => send({ type: 'pageTheme', value: 'light' }) }
            ]
          },
          {
            more: true,
            label: t('Brighter Interface'),
            type: 'checkbox',
            checked: st.view.uiBright,
            click: () => send({ type: 'uiBright' })
          },
          {
            more: true,
            // the size in use rides on the label; the steps are a tenth (#364),
            // from 90% up to the page zoom's own 300%
            label: t('Interface Size') + (st.uiZoom === 1 ? '' : ' — ' + new Intl.NumberFormat(st.uiLanguage || 'en', { style: 'percent' }).format(st.uiZoom)),
            submenu: [
              { label: t('Larger'), click: () => send({ type: 'uiZoomStep', value: 1 }) },
              { label: t('Smaller'), click: () => send({ type: 'uiZoomStep', value: -1 }) },
              { type: 'separator' },
              { label: t('Reset'), click: () => send({ type: 'uiZoomStep', value: 0 }) }
            ]
          },
          { type: 'separator' },
          {
            more: true,
            label: t('Language'),
            submenu: c.languages.map((lang) => ({
              label: lang.name,
              type: 'radio',
              checked: st.uiLanguage === lang.code,
              click: () => c.actions.setLanguage(lang.code)
            }))
          }
        ]
      },
      {
        role: 'windowMenu',
        label: t('Window'),
        submenu: [
          { role: 'minimize', label: t('Minimize') },
          { role: 'zoom', label: t('Zoom') },
          ...(isMac
            ? [{ type: 'separator' }, { role: 'front', label: t('Bring All to Front') }]
            : [{ role: 'close', label: t('Close') }])
        ]
      },
      {
        label: t('Help'),
        submenu: [
          {
            label: t('NEO Shortcuts'),
            click: () => send({ type: 'help' })
          },
          { type: 'separator' },
          {
            label: t('About NEO'),
            click: () => send({ type: 'about' })
          },
          {
            label: t('Check for Update…'),
            click: () => send({ type: 'checkUpdate' })
          }
        ]
      }
    ];
  }

  const api = { menuTemplate, simpleTemplate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoMenu = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
