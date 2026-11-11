// Every record table, in two views.
//
// A table is the right shape for comparing rows and the wrong shape for a
// phone, and several of these tables are wider than any laptop: the people
// directory carries ten columns, and the last of them — the row's own
// actions — is the first thing to disappear off the right-hand edge. You
// cannot act on a row whose buttons require a horizontal scroll to find.
//
// Three things follow, and this file does all three by reading the table that
// is already in the page rather than by asking thirty templates to change:
//
//   * **Cards and Table.** Cards are built from the same rows, one card each,
//     the header cell as the label. They wrap into as many columns as fit, so
//     a wide screen still shows several at once.
//   * **Actions move to the front.** Whichever column holds the row's buttons
//     is moved to the first position, where a horizontal scroll cannot take
//     it away.
//   * **Columns can be put away.** A menu lists every column; hiding the ones
//     this reader does not need is what makes a ten-column table fit.
//
// Upgrading the live DOM rather than the template keeps one implementation
// for tables that are rendered by six different services, and means a table
// added later is covered by adding a class.

(function () {
  'use strict';

  var SELECTOR = [
    'table.data-table',
    'table.people-table',
    'table.aeg-table',
    'table.workspace-table'
  ].join(',');

  // Below this a table has nowhere to go but sideways, so cards are the
  // default. Above it the table is the better of the two and stays the
  // default — a reader who prefers cards says so and is remembered.
  var CARDS_BELOW = 760;

  // A column whose header says this, or whose cells hold row controls, is the
  // actions column.
  var ACTION_HEADINGS = ['actions', 'action', ''];

  function text(node) {
    return (node && node.textContent ? node.textContent : '').replace(/\s+/g, ' ').trim();
  }

  function storageKey(table, index) {
    var name = table.getAttribute('data-table-key');
    return 'aegis-table:' + (name || window.location.pathname + ':' + index);
  }

  function readPreference(key) {
    try {
      return JSON.parse(window.localStorage.getItem(key) || 'null');
    } catch (error) {
      return null;
    }
  }

  function writePreference(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // A private window, or storage the reader has blocked. The view still
      // works; it just will not be the same one next time.
    }
  }

  /**
   * Which column holds the row's own controls.
   *
   * By what is in it rather than by what it is called: several of these
   * tables leave the header empty above the buttons, and one calls it
   * nothing at all.
   */
  function findActionsColumn(table, headers) {
    var body = table.tBodies[0];
    var rows = body ? Array.prototype.slice.call(body.rows) : [];

    // In order of how sure each test is. `.row-actions` is the wrapper this
    // product puts a row's controls in, so it is the answer wherever it
    // appears. Looking for any button or form instead found the credentials
    // table's "QR / link" column, which holds a button and is not the
    // actions, and missed the people directory, whose first row is the
    // administrator's own profile and is shaped differently from the rest.
    var tests = ['.row-actions', '.icon-button'];

    for (var t = 0; t < tests.length; t += 1) {
      for (var r = 0; r < rows.length; r += 1) {
        for (var index = 0; index < rows[r].cells.length; index += 1) {
          if (rows[r].cells[index].querySelector(tests[t])) {
            return index;
          }
        }
      }
    }

    // Last resort: a trailing column with no name, which is how several of
    // these tables label the one holding the buttons.
    var last = headers.length - 1;
    if (last >= 0 && ACTION_HEADINGS.indexOf(headers[last].toLowerCase()) !== -1) {
      return last;
    }
    return -1;
  }

  /** Move one column to the front, header and every row's cell together. */
  function moveColumnFirst(table, from) {
    if (from <= 0) {
      return;
    }

    var headRow = table.tHead && table.tHead.rows[0];
    if (headRow && headRow.cells[from]) {
      headRow.insertBefore(headRow.cells[from], headRow.cells[0]);
    }

    Array.prototype.forEach.call(table.tBodies, function (body) {
      Array.prototype.forEach.call(body.rows, function (row) {
        if (row.cells[from] && row.cells.length > from) {
          row.insertBefore(row.cells[from], row.cells[0]);
        }
      });
    });
  }

  function setColumnHidden(table, index, hidden) {
    var headRow = table.tHead && table.tHead.rows[0];
    if (headRow && headRow.cells[index]) {
      headRow.cells[index].hidden = hidden;
    }
    Array.prototype.forEach.call(table.tBodies, function (body) {
      Array.prototype.forEach.call(body.rows, function (row) {
        // A row that spans the table — "nothing here yet" — has one cell and
        // no columns to hide.
        if (row.cells.length > index && !row.cells[index].hasAttribute('colspan')) {
          row.cells[index].hidden = hidden;
        }
      });
    });
  }

  /**
   * One card per row: the header cell as the label, the row's own cell as the
   * value, and the row's controls at the foot where they are on a card
   * everywhere else in the product.
   */
  function buildCards(table, headers, actionsIndex) {
    var list = document.createElement('div');
    list.className = 'dt-cards';

    var body = table.tBodies[0];
    if (!body || !body.rows.length) {
      return list;
    }

    Array.prototype.forEach.call(body.rows, function (row) {
      // The empty-state row is one cell across the whole table.
      if (row.cells.length === 1 && row.cells[0].hasAttribute('colspan')) {
        var note = document.createElement('p');
        note.className = 'dt-cards__empty';
        note.textContent = text(row.cells[0]);
        list.appendChild(note);
        return;
      }

      var card = document.createElement('article');
      card.className = 'dt-card';

      var fields = document.createElement('dl');
      fields.className = 'dt-card__fields';
      var actions = null;

      Array.prototype.forEach.call(row.cells, function (cell, index) {
        var clone = cell.cloneNode(true);
        // Ids would be duplicated across the table and the cards, which
        // breaks every label and every modal target that uses one.
        Array.prototype.forEach.call(clone.querySelectorAll('[id]'), function (node) {
          node.removeAttribute('id');
        });
        if (clone.id) {
          clone.removeAttribute('id');
        }

        if (index === actionsIndex) {
          actions = document.createElement('div');
          actions.className = 'dt-card__actions';
          while (clone.firstChild) {
            actions.appendChild(clone.firstChild);
          }
          return;
        }

        var label = headers[index] || '';
        var value = text(clone);
        if (!value && !clone.querySelector('img, svg, input, select')) {
          return;
        }

        var pair = document.createElement('div');
        var term = document.createElement('dt');
        term.textContent = label;
        var definition = document.createElement('dd');
        while (clone.firstChild) {
          definition.appendChild(clone.firstChild);
        }
        pair.appendChild(term);
        pair.appendChild(definition);
        fields.appendChild(pair);
      });

      // The first field is the row's name; it leads the card rather than
      // sitting in the list as "Name: …".
      var first = fields.firstElementChild;
      if (first) {
        var heading = document.createElement('h4');
        heading.className = 'dt-card__title';
        var definitionNode = first.querySelector('dd');
        while (definitionNode && definitionNode.firstChild) {
          heading.appendChild(definitionNode.firstChild);
        }
        fields.removeChild(first);
        card.appendChild(heading);
      }

      card.appendChild(fields);
      if (actions && actions.childNodes.length) {
        card.appendChild(actions);
      }
      list.appendChild(card);
    });

    return list;
  }

  function buildControls(shell, table, headers, actionsIndex, state, save) {
    var bar = document.createElement('div');
    bar.className = 'dt-bar';

    var views = document.createElement('div');
    views.className = 'dt-views';
    views.setAttribute('role', 'group');
    views.setAttribute('aria-label', 'How to show these records');

    var buttons = {};
    [['cards', 'Cards'], ['table', 'Table']].forEach(function (pair) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'dt-views__button';
      button.textContent = pair[1];
      button.addEventListener('click', function () {
        state.view = pair[0];
        save();
        applyView();
      });
      views.appendChild(button);
      buttons[pair[0]] = button;
    });

    bar.appendChild(views);

    // The column menu. Only worth offering when there is more than one column
    // that could be put away.
    var hideable = headers
      .map(function (label, index) { return { label: label, index: index }; })
      .filter(function (column) {
        // The actions and the first real column are what a row is identified
        // and acted on by. Hiding either leaves a row nothing can be done
        // with.
        return column.index !== actionsIndex && column.index !== (actionsIndex === 0 ? 1 : 0);
      });

    if (hideable.length > 1) {
      var menuWrap = document.createElement('div');
      menuWrap.className = 'dt-columns';

      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'dt-columns__toggle';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Choose columns');
      toggle.innerHTML = '<span aria-hidden="true">&#8942;</span>';

      var menu = document.createElement('div');
      menu.className = 'dt-columns__menu';
      menu.hidden = true;

      var heading = document.createElement('p');
      heading.className = 'dt-columns__heading';
      heading.textContent = 'Columns';
      menu.appendChild(heading);

      hideable.forEach(function (column) {
        var row = document.createElement('label');
        row.className = 'dt-columns__item';
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = state.hidden.indexOf(column.index) === -1;
        box.addEventListener('change', function () {
          var at = state.hidden.indexOf(column.index);
          if (box.checked && at !== -1) {
            state.hidden.splice(at, 1);
          } else if (!box.checked && at === -1) {
            state.hidden.push(column.index);
          }
          save();
          applyColumns();
        });
        var name = document.createElement('span');
        name.textContent = column.label || 'Column ' + (column.index + 1);
        row.appendChild(box);
        row.appendChild(name);
        menu.appendChild(row);
      });

      toggle.addEventListener('click', function () {
        var open = menu.hidden;
        menu.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
      });

      document.addEventListener('click', function (event) {
        if (!menuWrap.contains(event.target) && !menu.hidden) {
          menu.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
        }
      });

      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !menu.hidden) {
          menu.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
          toggle.focus();
        }
      });

      menuWrap.appendChild(toggle);
      menuWrap.appendChild(menu);
      bar.appendChild(menuWrap);
    }

    function applyView() {
      var cards = state.view === 'cards';
      shell.classList.toggle('dt--cards', cards);
      shell.classList.toggle('dt--table', !cards);
      buttons.cards.setAttribute('aria-pressed', String(cards));
      buttons.table.setAttribute('aria-pressed', String(!cards));
    }

    function applyColumns() {
      headers.forEach(function (label, index) {
        setColumnHidden(table, index, state.hidden.indexOf(index) !== -1);
      });
    }

    return { bar: bar, applyView: applyView, applyColumns: applyColumns };
  }

  function upgrade(table, index) {
    if (table.closest('.dt') || table.hasAttribute('data-no-upgrade')) {
      return;
    }
    // A table inside another table's cell is part of that row, not a record
    // list of its own — the connected-app sub-tables are laid out that way.
    if (table.parentElement && table.parentElement.closest('table')) {
      return;
    }
    var headRow = table.tHead && table.tHead.rows[0];
    var body = table.tBodies[0];
    if (!headRow || !body) {
      return;
    }

    var headers = Array.prototype.map.call(headRow.cells, text);
    var actionsIndex = findActionsColumn(table, headers);

    // Front and centre, before anything reads positions.
    if (actionsIndex > 0) {
      moveColumnFirst(table, actionsIndex);
      headers.unshift(headers.splice(actionsIndex, 1)[0]);
      actionsIndex = 0;
    }

    var key = storageKey(table, index);
    var saved = readPreference(key) || {};
    var state = {
      view: saved.view === 'cards' || saved.view === 'table'
        ? saved.view
        : (window.innerWidth < CARDS_BELOW ? 'cards' : 'table'),
      hidden: Array.isArray(saved.hidden) ? saved.hidden.filter(function (n) {
        return Number.isInteger(n) && n >= 0 && n < headers.length;
      }) : []
    };

    function save() {
      writePreference(key, { view: state.view, hidden: state.hidden });
    }

    var shell = document.createElement('div');
    shell.className = 'dt';

    // The table keeps whatever wrapper it already had, so its own horizontal
    // scrolling still works.
    var existingWrap = table.closest('.aeg-table-wrap, .people-table-wrap, .table-responsive');
    var tableNode = existingWrap || table;
    tableNode.parentNode.insertBefore(shell, tableNode);

    var tableView = document.createElement('div');
    tableView.className = 'dt-table';
    tableView.appendChild(tableNode);

    var controls = buildControls(shell, table, headers, actionsIndex, state, save);
    var cards = buildCards(table, headers, actionsIndex);

    shell.appendChild(controls.bar);
    shell.appendChild(tableView);
    shell.appendChild(cards);

    controls.applyColumns();
    controls.applyView();
  }

  Array.prototype.forEach.call(document.querySelectorAll(SELECTOR), upgrade);
})();
