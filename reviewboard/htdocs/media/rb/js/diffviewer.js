// Constants
var BACKWARD = -1;
var FORWARD  = 1;
var INVALID  = -1;
var DIFF_SCROLLDOWN_AMOUNT = 100;
var VISIBLE_CONTEXT_SIZE = 5;

var ANCHOR_COMMENT = 1;
var ANCHOR_FILE = 2;
var ANCHOR_CHUNK = 4;


// State
var gDiff;


/*
 * A list of key bindings for the page.
 */
var gActions = [
    { // Previous file
        keys: "aAKP<m",
        onPress: function() {
            scrollToAnchor(GetNextAnchor(BACKWARD, ANCHOR_FILE));
        }
    },

    { // Next file
        keys: "fFJN>",
        onPress: function() {
            scrollToAnchor(GetNextAnchor(FORWARD, ANCHOR_FILE));
        }
    },

    { // Previous diff
        keys: "sSkp,,",
        onPress: function() {
            scrollToAnchor(GetNextAnchor(BACKWARD, ANCHOR_CHUNK | ANCHOR_FILE));
        }
    },

    { // Next diff
        keys: "dDjn..",
        onPress: function() {
            scrollToAnchor(GetNextAnchor(FORWARD, ANCHOR_CHUNK | ANCHOR_FILE));
        }
    },

    { // Recenter
        keys: unescape("%0D"),
        onPress: function() { scrollToAnchor(gAnchors[gSelectedAnchor]); }
    },

    { // Previous comment
        keys: "[x",
        onPress: function() {
            scrollToAnchor(GetNextAnchor(BACKWARD, ANCHOR_COMMENT));
        }
    },

    { // Next comment
        keys: "]c",
        onPress: function() {
            scrollToAnchor(GetNextAnchor(FORWARD, ANCHOR_COMMENT));
        }
    },

    { // Go to header
        keys: "gu;",
        onPress: function() {}
    },

    { // Go to footer
        keys: "GU:",
        onPress: function() {}
    }
];


// State variables
var gSelectedAnchor = INVALID;
var gFileAnchorToId = {};
var gInterdiffFileAnchorToId = {};
var gAnchors = $();
var gCommentDlg = null;
var gHiddenComments = {};
var gDiffHighlightBorder = null;
var gStartAtAnchor = null;


/*
 * Creates a comment block in the diff viewer.
 *
 * @param {jQuery} beginRow      The first table row to attach to.
 * @param {jQuery} endRow        The last table row to attach to.
 * @param {int}    beginLineNum  The line number to attach to.
 * @param {int}    endLineNum    The line number to attach to.
 * @param {array}  comments      The list of comments in this block.
 *
 * @return {object} The comment block.
 */
function DiffCommentBlock(beginRow, endRow, beginLineNum, endLineNum,
                          comments) {
    var self = this;

    var table = beginRow.parents("table:first")
    var fileid = table[0].id;

    this.filediff = gFileAnchorToId[fileid];
    this.interfilediff = gInterdiffFileAnchorToId[fileid];
    this.beginLineNum = beginLineNum;
    this.endLineNum = endLineNum;
    this.beginRow = beginRow;
    this.endRow = endRow;
    this.comments = [];
    this.draftComment = null;

    this.el = $("<span/>")
        .addClass("commentflag")
        .click(function() {
            self.showCommentDlg();
            return false;
        })

    this.countEl = $("<span/>")
        .appendTo(this.el);

    if ($.browser.msie && $.browser.version == 6) {
        /*
         * Tooltips for some reason cause comment flags to disappear in IE6.
         * So for now, just fake them and never show them.
         */
        this.tooltip = $("<div/>");
    } else {
        this.tooltip = $.tooltip(this.el, {
            side: "rb"
        }).addClass("comments");
    }

    this.anchor = $("<a/>")
        .attr("name",
              "file" + this.filediff['id'] + "line" + this.beginLineNum)
        .addClass("comment-anchor")
        .appendTo(this.el);

    /*
     * Find out if there's any draft comments, and filter them out of the
     * stored list of comments.
     */
    if (comments && comments.length > 0) {
        for (var i in comments) {
            var comment = comments[i];

            if (comment.localdraft) {
                this._createDraftComment(comment.text);
            } else {
                this.comments.push(comment);
            }
        }
    } else {
        this._createDraftComment();
    }

    this.updateCount();
    this.updateTooltip();

    /* Now that we've built everything, add this to the DOM. */
    this.beginRow[0].cells[0].appendChild(this.el[0]);
}

$.extend(DiffCommentBlock.prototype, {
    /*
     * Notifies the user of some update. This notification appears by the
     * comment flag.
     *
     * @param {string} text  The notification text.
     */
    notify: function(text) {
        var offset = this.el.offset();

        var bubble = $("<div/>")
            .addClass("bubble")
            .text(text)
            .appendTo(this.el);

        bubble
            .css({
                left: this.el.width(),
                top:  0,
                opacity: 0
            })
            .animate({
                top: "-=10px",
                opacity: 0.8
            }, 350, "swing")
            .delay(1200)
            .animate({
                top: "+=10px",
                opacity: 0
            }, 350, "swing", function() {
                bubble.remove();
            });
    },

    /*
     * Updates the tooltip contents.
     */
    updateTooltip: function() {
        this.tooltip.empty();
        var list = $("<ul/>");

        if (this.draftComment) {
            $("<li/>")
                .text(this.draftComment.text.truncate())
                .addClass("draft")
                .appendTo(list);
        }

        for (var i = 0; i < this.comments.length; i++) {
            $("<li/>")
                .text(this.comments[i].text.truncate())
                .appendTo(list);
        }

        list.appendTo(this.tooltip);
    },

    /*
     * Updates the displayed number of comments in the comment block.
     *
     * If there's a draft comment, it will be added to the count. Otherwise,
     * this depends solely on the number of published comments.
     */
    updateCount: function() {
        var count = this.comments.length;

        if (this.draftComment) {
            count++;
        }

        this.count = count;
        this.countEl.html(this.count);
    },

    /*
     * Shows the comment dialog.
     */
    showCommentDlg: function() {
        var self = this;

        if (gCommentDlg == null) {
            gCommentDlg = $("#comment-detail")
                .commentDlg()
                .css("z-index", 999);
            gCommentDlg.appendTo("body");
        }

        gCommentDlg
            .one("close", function() {
                self._createDraftComment();

                gCommentDlg
                    .setDraftComment(self.draftComment)
                    .setCommentsList(self.comments, "comment")
                    .css({
                        left: $(document).scrollLeft() +
                              ($(window).width() - gCommentDlg.width()) / 2,
                        top:  self.endRow.offset().top +
                              self.endRow.height()
                    })
                    .open(self.el);
            })
            .close();
    },

    _createDraftComment: function(textOnServer) {
        if (this.draftComment != null) {
            return;
        }

        var self = this;
        var el = this.el;
        var comment = new RB.DiffComment(this.filediff, this.interfilediff,
                                         this.beginLineNum, this.endLineNum,
                                         textOnServer);

        $.event.add(comment, "textChanged", function() {
            self.updateTooltip();
        });

        $.event.add(comment, "deleted", function() {
            self.notify("Comment Deleted");
        });

        $.event.add(comment, "destroyed", function() {
            self.draftComment = null;

            /* Discard the comment block if empty. */
            if (self.comments.length == 0) {
                el.fadeOut(350, function() { el.remove(); })
                self.anchor.remove();
            } else {
                el.removeClass("draft");
                self.updateCount();
                self.updateTooltip();
            }
        });

        $.event.add(comment, "saved", function() {
            self.updateCount();
            self.updateTooltip();
            self.notify("Comment Saved");
            showReviewBanner();
        });

        this.draftComment = comment;
        el.addClass("draft");
    }
});


/*
 * Registers a section as being a diff file.
 *
 * This handles all mouse actions on the diff, comment range selection, and
 * populatation of comment flags.
 *
 * @param {array} lines  The lines containing comments. See the
 *                       addCommentFlags documentation for the format.
 *
 * @return {jQuery} The diff file element.
 */
$.fn.diffFile = function(lines) {
    return this.each(function() {
        var self = $(this);

        /* State */
        var selection = {
            begin: null,
            beginNum: 0,
            end: null,
            endNum: 0,
            lastSeenIndex: 0
        };

        var ghostCommentFlag = $("<img/>")
            .addClass("commentflag")
            .addClass("ghost-commentflag")
            .attr("src", MEDIA_URL + "rb/images/comment-ghost.png?" +
                         MEDIA_SERIAL)
            .css({
                'position': 'absolute',
                'left': 2
            })
            .mousedown(function(e) { self.triggerHandler("mousedown", e); })
            .mouseup(function(e)   { self.triggerHandler("mouseup", e);   })
            .mouseover(function(e) { self.triggerHandler("mouseover", e); })
            .mouseout(function(e)  { self.triggerHandler("mouseout", e);  })
            .hide()
            .appendTo("body");

        var ghostCommentFlagCell = null;


        /* Events */
        self
            .mousedown(function(e) {
                /*
                 * Handles the mouse down event, which begins selection for
                 * comments.
                 *
                 * @param {event} e  The mousedown event.
                 */
                var node = e.target;

                if (ghostCommentFlagCell != null) {
                    node = ghostCommentFlagCell[0];
                }

                if (isLineNumCell(node)) {
                    var row = $(node.parentNode);

                    selection.begin    = selection.end    = row;
                    selection.beginNum = selection.endNum =
                        parseInt(row.attr('line'));

                    selection.lastSeenIndex = row[0].rowIndex;
                    row.addClass("selected");

                    self.disableSelection();

                    e.stopPropagation();
                    e.preventDefault();
                }
            })
            .mouseup(function(e) {
                /*
                 * Handles the mouse up event, which finalizes selection
                 * of a range of lines.
                 *
                 * This will create a new comment block and display the
                 * comment dialog.
                 *
                 * @param {event} e  The mouseup event.
                 */
                var node = e.target;

                if (ghostCommentFlagCell != null) {
                    node = ghostCommentFlagCell[0];
                }

                if (isLineNumCell(node)) {
                    /*
                     * Selection was finalized. Create the comment block
                     * and show the comment dialog.
                     */
                    var commentBlock = new DiffCommentBlock(selection.begin,
                                                            selection.end,
                                                            selection.beginNum,
                                                            selection.endNum);
                    commentBlock.showCommentDlg();

                    e.preventDefault();
                    e.stopPropagation();

                    $(node).removeClass("selected");
                } else {
                    /*
                     * The user clicked somewhere else. Move the anchor
                     * point here if it's part of the diff.
                     */
                    var tbody = $(node).parents("tbody:first");

                    if (tbody.length > 0 &&
                        (tbody.hasClass("delete") || tbody.hasClass("insert") ||
                         tbody.hasClass("replace"))) {
                        gotoAnchor($("a:first", tbody).attr("name"), true);
                    }
                }

                if (selection.begin != null) {
                    /* Reset the selection. */
                    var rows = self[0].rows;

                    for (var i = selection.begin[0].rowIndex;
                         i <= selection.end[0].rowIndex;
                         i++) {
                        $(rows[i]).removeClass("selected");
                    }

                    selection.begin    = selection.end    = null;
                    selection.beginNum = selection.endNum = 0;
                    selection.rows = [];
                }

                ghostCommentFlagCell = null;

                /* Re-enable text selection on IE */
                self.enableSelection();
            })
            .mouseover(function(e) {
                /*
                 * Handles the mouse over event. This will update the
                 * selection, if there is one, to include this row in the
                 * range, and set the "selected" class on the new row.
                 *
                 * @param {event} e  The mouseover event.
                 */
                var node = getActualRowNode($(e.target));
                var row = node.parent();

                if (isLineNumCell(node[0])) {
                    node.css("cursor", "pointer");

                    if (selection.begin != null) {
                        /* We have an active selection. */
                        var linenum = parseInt(row.attr("line"));

                        if (linenum < selection.beginNum) {
                            selection.beginNum = linenum;
                            selection.begin = row;
                        } else if (linenum > selection.beginNum) {
                            selection.end = row;
                            selection.endNum = linenum;
                        }

                        var min = Math.min(selection.lastSeenIndex,
                                           row[0].rowIndex);
                        var max = Math.max(selection.lastSeenIndex,
                                           row[0].rowIndex);

                        for (var i = min; i <= max; i++) {
                            $(self[0].rows[i]).addClass("selected");
                        }

                        selection.lastSeenIndex = row[0].rowIndex;
                    } else {
                        var lineNumCell = row[0].cells[0];

                        /* See if we have a comment flag in here. */
                        if ($(".commentflag", lineNumCell).length == 0) {
                            ghostCommentFlag
                                .css("top", node.offset().top - 1)
                                .show()
                                .parent()
                                    .removeClass("selected");
                            ghostCommentFlagCell = node;

                        }

                        row.addClass("selected");
                    }
                } else if (ghostCommentFlagCell != null &&
                           node[0] != ghostCommentFlagCell[0]) {
                    row.removeClass("selected");
                }
            })
            .mouseout(function(e) {
                /*
                 * Handles the mouse out event, removing any lines outside
                 * the new range from the selection.
                 *
                 * @param {event} e  The mouseout event.
                 */
                var relTarget = e.relatedTarget;
                var node = getActualRowNode($(e.fromElement ||
                                              e.originalTarget));

                if (relTarget != ghostCommentFlag[0]) {
                    ghostCommentFlag.hide();
                    ghostCommentFlagCell = null;
                }

                if (selection.begin != null) {
                    /* We have an active selection. */
                    if (relTarget != null && isLineNumCell(relTarget)) {
                        /*
                         * Remove the "selection" class from any rows no
                         * longer in this selection.
                         */
                        var destRowIndex = relTarget.parentNode.rowIndex;

                        if (destRowIndex >= selection.begin[0].rowIndex) {
                            for (var i = selection.lastSeenIndex;
                                 i > destRowIndex;
                                 i--) {
                                $(self[0].rows[i]).removeClass("selected");
                            }

                            selection.lastSeenIndex = destRowIndex;
                        }
                    }
                } else if (node != null && isLineNumCell(node[0])) {
                    /*
                     * Opera seems to generate lots of spurious mouse-out
                     * events, which would cause us to get all sorts of
                     * errors in here unless we check the target above.
                     */
                    node.parent().removeClass("selected");
                }
            });

        addCommentFlags(self, lines);

        /*
         * Returns whether a particular cell is a line number cell.
         *
         * @param {HTMLElement} cell  The cell element.
         *
         * @return {bool} true if the cell is the line number cell.
         */
        function isLineNumCell(cell) {
            return (cell.tagName == "TH" &&
                    cell.parentNode.getAttribute('line'));
        }


        /*
         * Returns the actual cell node in the table.
         *
         * If the node specified is the ghost flag, this will return the
         * cell the ghost flag represents.
         *
         * If this is a comment flag inside a cell, this will return the
         * comment flag's parent cell
         *
         * @return {jQuery} The row.
         */
        function getActualRowNode(node) {
            if (node.hasClass("commentflag")) {
                if (node[0] == ghostCommentFlag[0]) {
                    node = ghostCommentFlagCell;
                } else {
                    node = node.parent();
                }
            }

            return node;
        }
    });
};


/*
 * Highlights a chunk of the diff.
 *
 * This will create and move four border elements around the chunk. We use
 * these border elements instead of setting a border since few browsers
 * render borders on <tbody> tags the same, and give us few options for
 * styling.
 */
$.fn.highlightChunk = function() {
    var firstHighlight = false;

    if (!gDiffHighlightBorder) {
        var borderEl = $("<div/>")
            .addClass("diff-highlight-border")
            .css("position", "absolute");

        gDiffHighlightBorder = {
            top: borderEl.clone().appendTo("#diffs"),
            bottom: borderEl.clone().appendTo("#diffs"),
            left: borderEl.clone().appendTo("#diffs"),
            right: borderEl.clone().appendTo("#diffs")
        };

        firstHighlight = true;
    }

    var el = this.parents("tbody:first, thead:first");

    var borderWidth = gDiffHighlightBorder.left.width();
    var borderHeight = gDiffHighlightBorder.top.height();
    var borderOffsetX = borderWidth / 2;
    var borderOffsetY = borderHeight / 2;

    if ($.browser.msie && $.browser.version <= 8) {
        /* On IE, the black rectangle is too far to the top. */
        borderOffsetY = -borderOffsetY;

        if ($.browser.msie && $.browser.version == 8) {
            /* And on IE8, it's also too far to the left. */
            borderOffsetX = -borderOffsetX;
        }
    }

    var updateQueued = false;
    var oldLeft;
    var oldTop;
    var oldWidth;
    var oldHeight;

    /*
     * Updates the position of the border elements.
     */
    function updatePosition(event) {
        if (event && event.target &&
            event.target != window &&
            !event.target.getElementsByTagName) {

            /*
             * This is not a container. It might be a text node.
             * Ignore it.
             */
            return;
        }

        var offset = el.position();

        if (!offset) {
            return;
        }

        var left = Math.round(offset.left);
        var top = Math.round(offset.top);
        var width = el.outerWidth();
        var height = el.outerHeight();

        if (left == oldLeft &&
            top == oldTop &&
            width == oldWidth &&
            height == oldHeight) {

            /* The position and size haven't actually changed. */
            return;
        }

        var outerHeight = height + borderHeight;
        var outerWidth  = width + borderWidth;
        var outerLeft   = left - borderOffsetX;
        var outerTop    = top - borderOffsetY;

        gDiffHighlightBorder.left.css({
            left: outerLeft,
            top: outerTop,
            height: outerHeight
        });

        gDiffHighlightBorder.top.css({
            left: outerLeft,
            top: outerTop,
            width: outerWidth
        });

        gDiffHighlightBorder.right.css({
            left: outerLeft + width,
            top: outerTop,
            height: outerHeight
        });

        gDiffHighlightBorder.bottom.css({
            left: outerLeft,
            top: outerTop + height,
            width: outerWidth
        });

        oldLeft = left;
        oldTop = top;
        oldWidth = width;
        oldHeight = height;

        updateQueued = false;
    }

    /*
     * Updates the position after 50ms so we don't call updatePosition too
     * many times in response to a DOM change.
     */
    function queueUpdatePosition(event) {
        if (!updateQueued) {
            updateQueued = true;
            setTimeout(function() { updatePosition(event); }, 50);
        }
    }

    $(document).bind("DOMNodeInserted.highlightChunk", queueUpdatePosition);
    $(document).bind("DOMNodeRemoved.highlightChunk", queueUpdatePosition);
    $(window).bind("resize.highlightChunk", updatePosition);

    if (firstHighlight) {
        /*
         * There seems to be a bug where we often won't get this right
         * away on page load. Race condition, perhaps.
         */
        queueUpdatePosition();
    } else {
        updatePosition();
    }

    return this;
};


/*
 * Sets the active anchor on the page, optionally scrolling to it.
 *
 * @param {string} name    The anchor name.
 * @param {bool}   scroll  If true, scrolls the page to the anchor.
 */
function gotoAnchor(name, scroll) {
    return scrollToAnchor($("a[name=" + name + "]"), scroll || false);
}


/*
 * Finds the row in a table matching the specified line number.
 *
 * @param {HTMLElement} table     The table element.
 * @param {int}         linenum   The line number to search for.
 * @param {int}         startRow  Optional start row to search.
 * @param {int}         endRow    Optional end row to search.
 *
 * @param {HTMLElement} The resulting row, or null if not found.
 */
function findLineNumRow(table, linenum, startRow, endRow) {
    var row = null;
    var found = false;
    var row_offset = 1; // Get past the headers.

    if (table.rows.length - row_offset > linenum) {
        row = table.rows[row_offset + linenum];

        // Account for the "x lines hidden" row.
        if (row != null && parseInt(row.getAttribute('line')) == linenum) {
            return row;
        }
    }

    var low = startRow || 1;
    var high = Math.min(endRow || table.rows.length, table.rows.length);

    if (endRow != undefined) {
        /* See if we got lucky and found it in the last row. */
        if (parseInt(table.rows[endRow].getAttribute('line')) == linenum) {
            return table.rows[endRow];
        }
    } else if (row != null) {
        /*
         * We collapsed the rows (unless someone mucked with the DB),
         * so the desired row is less than the row number retrieved.
         */
        high = parseInt(row.getAttribute('line'))
    }

    /* Binary search for this cell. */
    for (var i = Math.round((low + high) / 2); low < high - 1;) {
        row = table.rows[row_offset + i];

        if (!row) {
            high--;
            continue;
        }

        var value = parseInt(row.getAttribute('line'))

        if (!value) {
            i++;
            continue;
        }

        /* See if we can use simple math to find the row quickly. */
        var guessRowNum = linenum - value;

        if (guessRowNum >= 0 && guessRowNum < table.rows.length) {
            var guessRow = table.rows[row_offset + i + guessRowNum];

            if (guessRow
                && parseInt(guessRow.getAttribute('line')) == linenum) {
                /* We found it using maths! */
                return guessRow;
            }
        }

        var oldHigh = high;
        var oldLow = low;

        if (value > linenum) {
            high = i;
        } else if (value < linenum) {
            low = i;
        } else {
            return row;
        }

        /*
         * Make sure we don't get stuck in an infinite loop. This can happen
         * when a comment is placed in a line that isn't being shown.
         */
        if (oldHigh == high && oldLow == low) {
            break;
        }

        i = Math.round((low + high) / 2);
    }

    // Well.. damn. Ignore this then.
    return null;
}


/*
 * Adds comment flags to a table.
 *
 * lines is an array of dictionaries grouping together comments on the
 * same line. The dictionaries contain the following keys:
 *
 *    text       - The text of the comment.
 *    line       - The first line number.
 *    num_lines  - The number of lines the comment spans.
 *    user       - A dictionary containing "username" and "name" keys
 *                 for the user.
 *    url        - The URL for the comment.
 *    localdraft - true if this is the current user's draft comment.
 *
 * @param {HTMLElement} table  The table to add flags to.
 * @param {object}      lines  The comment lines to add.
 */
function addCommentFlags(table, lines) {
    var remaining = {};

    var prevBeginRowIndex = undefined;

    for (var i in lines) {
        var line = lines[i];
        var numLines = line.num_lines;

        var beginLineNum = line.linenum;
        var endLineNum = beginLineNum + numLines - 1;
        var beginRow = findLineNumRow(table[0], beginLineNum,
                                      prevBeginRowIndex);

        if (beginRow != null) {
            prevBeginRowIndex = beginRow.rowIndex;

            var endRow = (endLineNum == beginLineNum
                          ? beginRow
                          : findLineNumRow(table[0], endLineNum,
                                           prevBeginRowIndex,
                                           prevBeginRowIndex + numLines - 1));


            /*
             * Note that endRow might be null if it exists in a collapsed
             * region, so we can get away with just using beginRow if we
             * need to.
             */
            new DiffCommentBlock($(beginRow), $(endRow || beginRow),
                                 beginLineNum, endLineNum, line.comments);
        } else {
            remaining[beginLineNum] = line;
        }
    }

    gHiddenComments = remaining;
}


/*
 * Expands a chunk of the diff.
 *
 * @param {string} fileid              The file ID.
 * @param {string} filediff_id         The FileDiff ID.
 * @param {string} revision            The revision of the file.
 * @param {string} interdiff_revision  The interdiff revision of the file.
 * @param {int}    chunk_index         The chunk index number.
 * @param {string} tbody_id            The tbody ID to insert into.
 */
function expandChunk(fileid, filediff_id, revision, interdiff_revision,
                     chunk_index, link) {
    gDiff.getDiffFragment(fileid, filediff_id, revision, interdiff_revision,
                          chunk_index, function(html) {
        var tbody = $(link).parents("tbody.collapsed");
        var table = tbody.parent();

        tbody.replaceWith(html);
        addCommentFlags(table, gHiddenComments);
    });
}


/*
 * Scrolls to the anchor at a specified location.
 *
 * @param {jQuery} anchor    The anchor jQuery instance.
 * @param {bool}   noscroll  true if the page should not be scrolled.
 *
 * @return {bool} true if the anchor was found, or false if not.
 */
function scrollToAnchor(anchor, noscroll) {
    if (anchor.length == 0) {
        return false;
    }

    if (anchor.parent().is(":hidden")) {
        return false;
    }

    if (!noscroll) {
        $(window).scrollTop(anchor.offset().top - DIFF_SCROLLDOWN_AMOUNT);
    }

    anchor.highlightChunk();

    for (var i = 0; i < gAnchors.length; i++) {
        if (gAnchors[i] == anchor[0]) {
            gSelectedAnchor = i;
            break;
        }
    }

    return true;
}


/*
 * Returns the next navigatable anchor in the specified direction.
 *
 * @param {int} dir         The direction (BACKWARD or FORWARD)
 * @param {int} anchorType  The type of the anchor as a bitmask
 *                          (ANCHOR_COMMENT, ANCHOR_FILE, ANCHOR_CHUNK)
 *
 * @return {jQuery} The found anchor jQuery instance, or INVALID.
 */
function GetNextAnchor(dir, anchorType) {
    for (var anchor = gSelectedAnchor + dir;
         anchor >= 0 && anchor < gAnchors.length;
         anchor = anchor + dir) {

        var anchorEl = $(gAnchors[anchor]);

        if (((anchorType & ANCHOR_COMMENT) &&
             anchorEl.hasClass("comment-anchor")) ||
            ((anchorType & ANCHOR_FILE) &&
             anchorEl.hasClass("file-anchor")) ||
            ((anchorType & ANCHOR_CHUNK) &&
             anchorEl.hasClass("chunk-anchor"))) {
            return anchorEl;
        }
    }

    return $([]);
}


/*
 * Updates the list of known anchors based on named anchors in the specified
 * table. This is called after every part of the diff that we loaded.
 *
 * If no anchor is selected, we'll try to select the first one.
 *
 * @param {jQuery} table  The table to load anchors from.
 */
function updateAnchors(table) {
    gAnchors = gAnchors.add($("a[name]", table));

    /* Skip over the change index to the first item */
    if (gSelectedAnchor == -1 && gAnchors.length > 0) {
      gSelectedAnchor = 0;
      $(gAnchors[gSelectedAnchor]).highlightChunk();
    }
}


/*
 * Progressively load a diff.
 *
 * When the diff is loaded, it will be placed into the appropriate location
 * in the diff viewer, rebuild the anchors, and move on to the next file.
 *
 * @param {string} filediff_id               The filediff ID
 * @param {string} filediff_revision         The filediff revision
 * @param {string} interfilediff_id          The interfilediff ID (optional)
 * @param {string} interfilediff_revision    The interfilediff revision
 *                                           (optional)
 * @param {string} file_index                The file index
 * @param {dict}   comment_counts            The comments for this region
 */
function loadFileDiff(filediff_id, filediff_revision,
                      interfilediff_id, interfilediff_revision,
                      file_index,
                      comment_counts) {

    if ($("#file" + filediff_id).length == 1) {
        /* We already have this one. This is probably a pre-loaded file. */
        setupFileDiff();
    } else {
        var revision_str = filediff_revision;

        if (interfilediff_id) {
            revision_str += "-" + interfilediff_revision;
        }

        $.funcQueue("diff_files").add(function() {
            gDiff.getDiffFile(filediff_id, file_index, onFileLoaded);
        });
    }

    function onFileLoaded(xhr) {
        $("#file_container_" + filediff_id).replaceWith(xhr.responseText);

        setupFileDiff();
    }

    function setupFileDiff() {
        var key = "file" + filediff_id;

        gFileAnchorToId[key] = {
            'id': filediff_id,
            'revision': filediff_revision
        };

        if (interfilediff_id) {
            gInterdiffFileAnchorToId[key] = {
                'id': interfilediff_id,
                'revision': interfilediff_revision
            };
        }

        var diffTable = $("#file" + filediff_id);
        diffTable.diffFile(comment_counts);

        /* We must rebuild this every time. */
        updateAnchors(diffTable);

        if (gStartAtAnchor != null) {
            /* See if we've loaded the anchor the user wants to start at. */
            var anchor = $("a[name='" + gStartAtAnchor + "']");

            if (anchor.length != 0) {
                scrollToAnchor(anchor);
                gStartAtAnchor = null;
            }
        }

        $.funcQueue("diff_files").next();
    }
}


/*
 * Toggles the display state of Whitespace chunks and lines.
 *
 * When a diff is loaded, by default, all whitespace only changes are shown.
 * This function hides the changes shown and show the hidden changes,
 * toggling the state.
 */
function toggleWhitespaceChunks()
{
    var tables = $("table.sidebyside");
    var chunks = tables.children("tbody.whitespace-chunk");

    /* Dim the whole chunk */
    chunks.toggleClass("replace");

    /* Dim the anchor to each chunk in the file list */
    chunks.each(function() {
        var target = this.id.split("chunk")[1];
        $("ol.index a[href=#" + target + "]").toggleClass("dimmed");
    });

    /* Remove chunk identifiers */
    chunks.children(":first-child").toggleClass("first");
    chunks.children(":last-child").toggleClass("last");

    /* Toggle individual lines */
    tables.find("tbody tr.whitespace-line").toggleClass("dimmed");

    /* Toggle the display of the button itself */
    $(".review-request ul.controls li:gt(0)").toggle();

    /* Toggle adjacent chunks, and show the whitespace message */
    tables.children("tbody.whitespace-file").toggle()
                                            .siblings("tbody")
                                                .toggle();
}


$(document).ready(function() {
    gDiff = gReviewRequest.createDiff(gRevision, gInterdiffRevision);

    $(document).keypress(function(evt) {
        if (evt.altKey || evt.ctrlKey || evt.metaKey) {
            return;
        }

        var keyChar = String.fromCharCode(evt.which);

        for (var i = 0; i < gActions.length; i++) {
            if (gActions[i].keys.indexOf(keyChar) != -1) {
                gActions[i].onPress();
                return false;
            }
        }
    });

    $("ul.controls li a.toggleWhitespaceButton").click(function() {
        toggleWhitespaceChunks();
        return false;
    });

    /*
     * Make sure any inputs on the page (such as the search box) don't
     * bubble down key presses to the document.
     */
    $("input, textarea").keypress(function(evt) {
        evt.stopPropagation();
    });

    /* Check to see if there's an anchor we need to scroll to. */
    var url = document.location.toString();

    if (url.match("#")) {
        gStartAtAnchor = url.split("#")[1];
    }

    $.funcQueue("diff_files").start();
});

// vim: set et: