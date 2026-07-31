// A real button in the component inspector.
//
// TyranoBuilder ships no button a plugin can act on. It has one param type that
// *renders* a button — `PreviewButton` — but the label is hard-coded to
// `$.s("プレビュー")` and the click handler goes straight to
// `app.previewGameFromScenario()`; it never looks at the param definition. Of
// the built-in types only `Text`, `Select` and `Check` call `onChange` at all,
// which is why the Reconvert control started life as a tick box that unticks
// itself.
//
// The way out is that `Builder.Core.Param.create()` resolves a view by name at
// render time — `new Builder['Param'][type]({param_name, param, component})` —
// so a plugin can add its own. All of this was read off the shipped builder
// (Ver 3.00): `js/app/core/param.js` for the lookup and the render loop,
// `js/app/param/base.js` for the base view.
//
// That lookup has no guard: an unregistered type name evaluates to `undefined`,
// `new undefined(...)` throws, and `create()` dies before it sets
// `array_param` — which blanks the whole inspector for that component, not just
// this one row. So registration is proven first and the type name is only
// claimed if it took.

/** The name this view registers under, and the `type` a param then uses. */
export const BUTTON_PARAM_TYPE = 'SSPlayerButton';

/** What a param definition using {@link BUTTON_PARAM_TYPE} supplies. */
export interface ButtonParamDefinition {
  /** Text on the button itself. The row's own label is `name`, as usual. */
  label?: string;
  onClick?: (component: unknown) => void;
}

/** The slice of jQuery this view needs: a factory that also builds elements. */
type JQueryFactory = (html: string) => {
  append(child: unknown): unknown;
  on(event: string, handler: () => void): unknown;
};

/** `Builder`, a plain global in the renderer the plugin shares with the editor. */
interface BuilderGlobal {
  Param?: Record<string, unknown> & {
    Base?: { extend?: (proto: Record<string, unknown>) => unknown };
  };
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Define the button view on `Builder`, and report whether a param may now ask
 * for it. `false` means the caller must fall back to a built-in type.
 *
 * Idempotent: the editor rebuilds every plugin whenever any one of them is
 * added, removed or installed, and re-registering would swap the class out from
 * under inspectors already holding an instance of it.
 */
export function registerButtonParam(jquery: unknown, builder: unknown): boolean {
  const param = (builder as BuilderGlobal | undefined)?.Param;
  const base = param?.Base;
  const $ = jquery as JQueryFactory | undefined;
  if (!param || typeof base?.extend !== 'function' || typeof $ !== 'function') return false;
  if (param[BUTTON_PARAM_TYPE]) return true;

  param[BUTTON_PARAM_TYPE] = base.extend({
    defaults: { type: '' },
    j_view: {},
    createHtml(this: {
      get(key: string): unknown;
      j_view: unknown;
    }) {
      const definition = (this.get('param') ?? {}) as ButtonParamDefinition;
      const component = this.get('component');
      const root = $('<div></div>');
      const button = $(
        `<input type="button" class="btn btn-info btn-sm" value="${escapeAttr(
          definition.label ?? '',
        )}" />`,
      );
      button.on('click', () => definition.onClick?.(component));
      root.append(button);
      this.j_view = root;
      return root;
    },
    // `Base.valid()` finds the control with `$('.tb-parameter [name=…]')` and
    // hands it to jQuery-validate. A bare button carries no `name`, so that
    // selector is empty — `PreviewButton` has the same shape and survives it,
    // but there is nothing here to validate either way.
    valid: () => true,
    setEvents() {},
  });
  return true;
}
