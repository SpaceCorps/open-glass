/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GlassContext, type GlassContextValue } from "../src/context/GlassContext";

import { GlassInput } from "../src/components/GlassInput";
import { GlassToggle } from "../src/components/GlassToggle";
import { GlassSlider } from "../src/components/GlassSlider";
import { GlassCheckbox } from "../src/components/GlassCheckbox";
import { GlassSelect } from "../src/components/GlassSelect";
import { FIELD_CSS_BACKDROP, snapToStep } from "../src/components/glassFieldStyles";

beforeAll(() => {
  // Legitimately "no WebGL2 available", which is the CSS-fallback path.
  HTMLCanvasElement.prototype.getContext = vi
    .fn()
    .mockReturnValue(null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  if (typeof window !== "undefined" && !window.PointerEvent) {
    window.PointerEvent = class PointerEvent extends MouseEvent {} as any;
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockContext = (overrides: Partial<GlassContextValue> = {}): GlassContextValue => ({
  engine: null,
  registerElement: vi.fn(),
  updateElement: vi.fn(),
  unregisterElement: vi.fn(),
  hasBackgroundSource: false,
  isRenderReady: false,
  containerRef: { current: null },
  ...overrides,
});

const selectOptions = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

/** Every control, its accessible role, and the `cornerRadius` it registers by default. */
const controls = [
  {
    name: "GlassInput",
    role: "textbox",
    cornerRadius: 12,
    tagName: "INPUT",
    render: (style?: React.CSSProperties) => <GlassInput label="Name" style={style} />,
  },
  {
    name: "GlassToggle",
    role: "switch",
    cornerRadius: 15,
    tagName: "BUTTON",
    render: (style?: React.CSSProperties) => <GlassToggle label="Wi-Fi" style={style} />,
  },
  {
    name: "GlassSlider",
    role: "slider",
    cornerRadius: 8,
    tagName: "INPUT",
    render: (style?: React.CSSProperties) => <GlassSlider label="Volume" style={style} />,
  },
  {
    name: "GlassCheckbox",
    role: "checkbox",
    cornerRadius: 6,
    tagName: "INPUT",
    render: (style?: React.CSSProperties) => <GlassCheckbox label="Analytics" style={style} />,
  },
  {
    name: "GlassSelect",
    role: "combobox",
    cornerRadius: 12,
    tagName: "SELECT",
    render: (style?: React.CSSProperties) => (
      <GlassSelect label="Theme" options={selectOptions} style={style} />
    ),
  },
] as const;

describe("Glass form controls — semantics and glass contract", () => {
  for (const control of controls) {
    it(`${control.name} renders and is queryable by its role`, () => {
      render(control.render());
      const el = screen.getByRole(control.role);
      expect(el).toBeDefined();
      expect(el.tagName).toBe(control.tagName);
    });

    it(`${control.name} registers a quad with its default cornerRadius`, () => {
      const context = mockContext();
      render(<GlassContext.Provider value={context}>{control.render()}</GlassContext.Provider>);

      const el = screen.getByRole(control.role);
      expect(context.registerElement).toHaveBeenCalledWith(
        expect.objectContaining({ cornerRadius: control.cornerRadius }),
        el,
      );
    });

    it(`${control.name} keeps the CSS backdrop-filter until the renderer is ready`, () => {
      render(
        <GlassContext.Provider value={mockContext({ isRenderReady: false })}>
          {control.render()}
        </GlassContext.Provider>,
      );
      expect(screen.getByRole(control.role).style.backdropFilter).toContain(FIELD_CSS_BACKDROP);
    });

    it(`${control.name} drops the CSS backdrop-filter to none once the renderer is ready`, () => {
      render(
        <GlassContext.Provider value={mockContext({ isRenderReady: true })}>
          {control.render()}
        </GlassContext.Provider>,
      );
      expect(screen.getByRole(control.role).style.backdropFilter).toBe("none");
    });

    it(`${control.name} stays on CSS glass when a background exists but the renderer draws nothing`, () => {
      render(
        <GlassContext.Provider
          value={mockContext({ hasBackgroundSource: true, isRenderReady: false })}
        >
          {control.render()}
        </GlassContext.Provider>,
      );
      const el = screen.getByRole(control.role);
      expect(el.style.backdropFilter).not.toBe("none");
      expect(el.style.backdropFilter).toContain(FIELD_CSS_BACKDROP);
    });

    it(`${control.name} keeps its CSS blur with no provider at all`, () => {
      // `useContext` outside a provider yields `null`, which must never read as ready.
      render(control.render());
      expect(screen.getByRole(control.role).style.backdropFilter).toContain(FIELD_CSS_BACKDROP);
    });

    it(`${control.name} is focusable and does not opt out of the tab order`, () => {
      render(control.render());
      const el = screen.getByRole(control.role);
      act(() => {
        el.focus();
      });
      expect(document.activeElement).toBe(el);
      expect(el.getAttribute("tabindex")).not.toBe("-1");
    });
  }
});

describe("Glass form controls — readiness handover", () => {
  // Plan 00653 fixed this abrupt-flash defect for the panel components with `glassHandoverStyle`;
  // the five form controls were landed in parallel by Plan 00652 and stayed un-routed through it.
  for (const control of controls) {
    for (const isRenderReady of [false, true]) {
      it(`${control.name} includes the 260ms handover transition when isRenderReady is ${isRenderReady}`, () => {
        render(
          <GlassContext.Provider value={mockContext({ isRenderReady })}>
            {control.render()}
          </GlassContext.Provider>,
        );
        expect(screen.getByRole(control.role).style.transition).toMatch(/background-color \d+ms/);
      });
    }

    it(`${control.name} composes a caller-provided style.transition with the handover transition`, () => {
      render(control.render({ transition: "opacity 1s ease" }));
      const el = screen.getByRole(control.role);
      expect(el.style.transition).toContain("opacity 1s ease");
      expect(el.style.transition).toMatch(/background-color \d+ms/);
    });
  }
});

describe("Glass form controls — focus indicator", () => {
  for (const control of controls) {
    it(`${control.name} shows a ring on keyboard focus and never uses outline: none`, () => {
      render(control.render());
      const el = screen.getByRole(control.role);

      const resting = el.style.boxShadow;
      // A real focus, so `document.activeElement` is set and the modality is the keyboard's.
      // `act` is what flushes the resulting render — a bare `focus()` schedules it but does not.
      act(() => {
        el.focus();
      });

      expect(el.style.boxShadow).not.toBe("");
      expect(el.style.boxShadow).not.toBe(resting);
      // The ring is a border + stacked box-shadows, so it survives `backdrop-filter: none`.
      expect(el.style.boxShadow).toContain("rgba(120, 180, 255, 0.65)");
      // The regression gate against copying GlassButton's pattern.
      expect(el.style.outline).not.toBe("none");
    });

    it(`${control.name} suppresses the ring when focus arrives from a pointer`, () => {
      render(control.render());
      const el = screen.getByRole(control.role);

      const resting = el.style.boxShadow;
      fireEvent.pointerDown(el);
      act(() => {
        el.focus();
      });

      expect(el.style.boxShadow).toBe(resting);
      expect(el.style.boxShadow).not.toContain("rgba(120, 180, 255, 0.65)");
    });

    it(`${control.name} clears the ring on blur`, () => {
      render(control.render());
      const el = screen.getByRole(control.role);

      const resting = el.style.boxShadow;
      act(() => {
        el.focus();
      });
      expect(el.style.boxShadow).not.toBe(resting);

      fireEvent.blur(el);
      expect(el.style.boxShadow).toBe(resting);
    });
  }

  it("still calls the caller's focus, blur and pointerDown handlers", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const onPointerDown = vi.fn();

    render(<GlassInput onFocus={onFocus} onBlur={onBlur} onPointerDown={onPointerDown} />);
    const el = screen.getByRole("textbox");

    fireEvent.pointerDown(el);
    fireEvent.focus(el);
    fireEvent.blur(el);

    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});

describe("GlassInput", () => {
  it("forwards its ref to the input node", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<GlassInput ref={ref} />);
    expect(ref.current).toBe(screen.getByRole("textbox"));
  });

  it("associates its label with the input", () => {
    render(<GlassInput label="Display name" />);
    const el = screen.getByLabelText("Display name");
    expect(el.tagName).toBe("INPUT");
  });

  it("drives a controlled value and reports changes", () => {
    const onChange = vi.fn();
    render(<GlassInput value="hello" onChange={onChange} />);
    const el = screen.getByRole("textbox") as HTMLInputElement;

    expect(el.value).toBe("hello");
    fireEvent.change(el, { target: { value: "hello world" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    // Controlled: the prop still wins, so the DOM has not drifted from it.
    expect(el.value).toBe("hello");
  });

  it("seeds an uncontrolled value from defaultValue and lets it change", () => {
    render(<GlassInput defaultValue="seed" />);
    const el = screen.getByRole("textbox") as HTMLInputElement;

    expect(el.value).toBe("seed");
    fireEvent.change(el, { target: { value: "typed" } });
    expect(el.value).toBe("typed");
  });

  it("blocks input when disabled or readOnly", () => {
    // `disabled` / `readOnly` are what the UA enforces, so those properties reaching the DOM node —
    // and the disabled styling being applied — is the whole contract. A `fireEvent.change` is
    // dispatched programmatically and bypasses the very UA gate under test, so it proves nothing
    // here either way.
    const { unmount } = render(<GlassInput disabled defaultValue="locked" />);
    const disabledEl = screen.getByRole("textbox") as HTMLInputElement;
    expect(disabledEl.disabled).toBe(true);
    expect(disabledEl.style.cursor).toBe("not-allowed");
    expect(disabledEl.style.opacity).toBe("0.45");
    unmount();

    render(<GlassInput readOnly defaultValue="locked" />);
    const readOnlyEl = screen.getByRole("textbox") as HTMLInputElement;
    expect(readOnlyEl.readOnly).toBe(true);
    expect(readOnlyEl.value).toBe("locked");
  });

  it("exposes an error through role=alert, aria-invalid and aria-describedby", () => {
    render(<GlassInput label="Email" error="Not an email" />);
    const el = screen.getByRole("textbox");

    expect(screen.getByRole("alert").textContent).toBe("Not an email");
    expect(el.getAttribute("aria-invalid")).toBe("true");
    const describedBy = el.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("Not an email");
  });

  it("merges a caller-supplied aria-describedby rather than replacing it", () => {
    render(<GlassInput aria-describedby="hint-1" error="Bad" />);
    const describedBy = screen.getByRole("textbox").getAttribute("aria-describedby") ?? "";
    expect(describedBy.split(" ")).toHaveLength(2);
    expect(describedBy.startsWith("hint-1 ")).toBe(true);
  });

  it("marks invalid without an error message", () => {
    render(<GlassInput invalid />);
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves aria-invalid unset when valid", () => {
    render(<GlassInput />);
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBeNull();
  });

  it("passes type and placeholder through", () => {
    render(<GlassInput type="password" placeholder="secret" aria-label="Password" />);
    const el = screen.getByLabelText("Password") as HTMLInputElement;
    expect(el.type).toBe("password");
    expect(el.placeholder).toBe("secret");
  });
});

describe("GlassToggle", () => {
  it("forwards its ref to the button node", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<GlassToggle ref={ref} label="Wi-Fi" />);
    expect(ref.current).toBe(screen.getByRole("switch"));
  });

  it("reports aria-checked and labels itself from `label`", () => {
    render(<GlassToggle label="Wi-Fi" checked />);
    const el = screen.getByRole("switch");
    expect(el.getAttribute("aria-checked")).toBe("true");
    expect(el.getAttribute("aria-label")).toBe("Wi-Fi");
  });

  it("stays controlled: the prop wins and the change is reported", () => {
    const onCheckedChange = vi.fn();
    render(<GlassToggle checked={false} onCheckedChange={onCheckedChange} label="Wi-Fi" />);
    const el = screen.getByRole("switch");

    fireEvent.click(el);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(el.getAttribute("aria-checked")).toBe("false");
  });

  it("toggles itself when uncontrolled", () => {
    render(<GlassToggle defaultChecked label="Wi-Fi" />);
    const el = screen.getByRole("switch");

    expect(el.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(el);
    expect(el.getAttribute("aria-checked")).toBe("false");
  });

  it("toggles on Space and on Enter, exactly once each", () => {
    const onCheckedChange = vi.fn();
    render(<GlassToggle defaultChecked={false} onCheckedChange={onCheckedChange} label="Wi-Fi" />);
    const el = screen.getByRole("switch");

    fireEvent.keyDown(el, { key: " " });
    expect(el.getAttribute("aria-checked")).toBe("true");
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    fireEvent.keyDown(el, { key: "Enter" });
    expect(el.getAttribute("aria-checked")).toBe("false");
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);

    expect(onCheckedChange).toHaveBeenCalledTimes(2);
  });

  it("cancels the default action for Space and Enter", () => {
    render(<GlassToggle label="Wi-Fi" />);
    const el = screen.getByRole("switch");
    // Uncancelled Space scrolls the page, and an uncancelled key also fires the button's own
    // activation, which would toggle twice.
    expect(fireEvent.keyDown(el, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(el, { key: "Enter" })).toBe(false);
  });

  it("ignores unrelated keys", () => {
    const onCheckedChange = vi.fn();
    render(<GlassToggle onCheckedChange={onCheckedChange} label="Wi-Fi" />);
    const el = screen.getByRole("switch");

    fireEvent.keyDown(el, { key: "a" });
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(el.getAttribute("aria-checked")).toBe("false");
  });

  it("changes nothing when disabled", () => {
    const onCheckedChange = vi.fn();
    render(<GlassToggle disabled onCheckedChange={onCheckedChange} label="Wi-Fi" />);
    const el = screen.getByRole("switch") as HTMLButtonElement;

    expect(el.disabled).toBe(true);
    fireEvent.click(el);
    fireEvent.keyDown(el, { key: " " });
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(el.getAttribute("aria-checked")).toBe("false");
  });

  it("calls the caller's onClick alongside the toggle", () => {
    const onClick = vi.fn();
    const onCheckedChange = vi.fn();
    render(<GlassToggle onClick={onClick} onCheckedChange={onCheckedChange} label="Wi-Fi" />);

    fireEvent.click(screen.getByRole("switch"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
  });
});

describe("GlassSlider", () => {
  it("forwards its ref to a native range input", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<GlassSlider ref={ref} label="Volume" />);
    const el = screen.getByRole("slider") as HTMLInputElement;
    expect(ref.current).toBe(el);
    expect(el.type).toBe("range");
  });

  it("mirrors min, max and the current value into aria", () => {
    render(<GlassSlider min={10} max={40} step={5} value={25} />);
    const el = screen.getByRole("slider");
    expect(el.getAttribute("aria-valuemin")).toBe("10");
    expect(el.getAttribute("aria-valuemax")).toBe("40");
    expect(el.getAttribute("aria-valuenow")).toBe("25");
  });

  it("does not re-declare role=slider on the native element", () => {
    render(<GlassSlider />);
    expect(screen.getByRole("slider").getAttribute("role")).toBeNull();
  });

  it("stays controlled: the prop wins and onValueChange reports the step", () => {
    const onValueChange = vi.fn();
    render(<GlassSlider value={50} step={5} onValueChange={onValueChange} />);
    const el = screen.getByRole("slider");

    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(onValueChange).toHaveBeenCalledWith(55);
    expect(el.getAttribute("aria-valuenow")).toBe("50");
  });

  it("steps an uncontrolled value with the arrow keys", () => {
    render(<GlassSlider defaultValue={50} step={5} />);
    const el = screen.getByRole("slider") as HTMLInputElement;

    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(el.value).toBe("55");
    expect(el.getAttribute("aria-valuenow")).toBe("55");

    fireEvent.keyDown(el, { key: "ArrowLeft" });
    expect(el.value).toBe("50");

    fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(el.value).toBe("55");

    fireEvent.keyDown(el, { key: "ArrowDown" });
    expect(el.value).toBe("50");
  });

  it("clamps to min and max with Home and End", () => {
    render(<GlassSlider min={10} max={90} step={5} defaultValue={50} />);
    const el = screen.getByRole("slider") as HTMLInputElement;

    fireEvent.keyDown(el, { key: "Home" });
    expect(el.value).toBe("10");
    fireEvent.keyDown(el, { key: "End" });
    expect(el.value).toBe("90");
  });

  it("moves by ten steps on PageUp and PageDown", () => {
    render(<GlassSlider min={0} max={100} step={2} defaultValue={50} />);
    const el = screen.getByRole("slider") as HTMLInputElement;

    fireEvent.keyDown(el, { key: "PageUp" });
    expect(el.value).toBe("70");
    fireEvent.keyDown(el, { key: "PageDown" });
    expect(el.value).toBe("50");
  });

  it("never steps past its bounds", () => {
    const onValueChange = vi.fn();
    render(
      <GlassSlider min={0} max={100} step={5} defaultValue={100} onValueChange={onValueChange} />,
    );
    const el = screen.getByRole("slider") as HTMLInputElement;

    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(el.value).toBe("100");
    // Already at the bound, so nothing changed and nothing was reported.
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.keyDown(el, { key: "Home" });
    expect(el.value).toBe("0");
    fireEvent.keyDown(el, { key: "ArrowLeft" });
    expect(el.value).toBe("0");
  });

  it("cancels the UA's own stepping so a key moves exactly one step", () => {
    render(<GlassSlider defaultValue={50} />);
    const el = screen.getByRole("slider");
    expect(fireEvent.keyDown(el, { key: "ArrowRight" })).toBe(false);
    expect(fireEvent.keyDown(el, { key: "PageUp" })).toBe(false);
  });

  it("ignores unrelated keys without cancelling them", () => {
    const onValueChange = vi.fn();
    render(<GlassSlider defaultValue={50} onValueChange={onValueChange} />);
    const el = screen.getByRole("slider");
    expect(fireEvent.keyDown(el, { key: "a" })).toBe(true);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("reports pointer drags through onValueChange as well", () => {
    const onValueChange = vi.fn();
    render(<GlassSlider defaultValue={20} step={5} onValueChange={onValueChange} />);
    const el = screen.getByRole("slider") as HTMLInputElement;

    fireEvent.change(el, { target: { value: "35" } });
    expect(onValueChange).toHaveBeenCalledWith(35);
    expect(el.value).toBe("35");
  });

  it("snaps an off-step value onto the step grid", () => {
    const onValueChange = vi.fn();
    render(
      <GlassSlider min={0} max={100} step={10} defaultValue={0} onValueChange={onValueChange} />,
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "37" } });
    expect(onValueChange).toHaveBeenCalledWith(40);
  });

  it("changes nothing when disabled", () => {
    const onValueChange = vi.fn();
    render(<GlassSlider disabled defaultValue={50} onValueChange={onValueChange} />);
    const el = screen.getByRole("slider") as HTMLInputElement;

    expect(el.disabled).toBe(true);
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(el.value).toBe("50");
  });
});

describe("GlassCheckbox", () => {
  it("forwards its ref to a native checkbox", () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<GlassCheckbox ref={ref} label="Analytics" />);
    const el = screen.getByRole("checkbox") as HTMLInputElement;
    expect(ref.current).toBe(el);
    expect(el.type).toBe("checkbox");
  });

  it("associates its label with the input", () => {
    render(<GlassCheckbox label="Share analytics" />);
    expect(screen.getByLabelText("Share analytics").tagName).toBe("INPUT");
  });

  it("stays controlled: the prop wins and the change is reported", () => {
    const onCheckedChange = vi.fn();
    render(<GlassCheckbox checked={false} onCheckedChange={onCheckedChange} label="Analytics" />);
    const el = screen.getByRole("checkbox") as HTMLInputElement;

    fireEvent.click(el);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(el.checked).toBe(false);
  });

  it("toggles itself when uncontrolled", () => {
    render(<GlassCheckbox defaultChecked label="Analytics" />);
    const el = screen.getByRole("checkbox") as HTMLInputElement;

    expect(el.checked).toBe(true);
    fireEvent.click(el);
    expect(el.checked).toBe(false);
  });

  it("toggles on Space, exactly once", () => {
    const onCheckedChange = vi.fn();
    render(<GlassCheckbox onCheckedChange={onCheckedChange} label="Analytics" />);
    const el = screen.getByRole("checkbox") as HTMLInputElement;

    expect(fireEvent.keyDown(el, { key: " " })).toBe(false);
    expect(el.checked).toBe(true);
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("reports the third state as a DOM property and aria-checked=mixed", () => {
    render(<GlassCheckbox indeterminate label="Sync" />);
    const el = screen.getByRole("checkbox") as HTMLInputElement;

    expect(el.indeterminate).toBe(true);
    // `indeterminate` has no attribute form — a property is the only way to express it.
    expect(el.getAttribute("indeterminate")).toBeNull();
    expect(el.getAttribute("aria-checked")).toBe("mixed");
  });

  it("mirrors checked into aria-checked when not indeterminate", () => {
    render(<GlassCheckbox checked label="Analytics" />);
    const el = screen.getByRole("checkbox") as HTMLInputElement;
    expect(el.indeterminate).toBe(false);
    expect(el.getAttribute("aria-checked")).toBe("true");
  });

  it("changes nothing when disabled", () => {
    const onCheckedChange = vi.fn();
    render(<GlassCheckbox disabled onCheckedChange={onCheckedChange} label="Analytics" />);
    const el = screen.getByRole("checkbox") as HTMLInputElement;

    expect(el.disabled).toBe(true);
    fireEvent.click(el);
    fireEvent.keyDown(el, { key: " " });
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(el.checked).toBe(false);
  });

  it("renders bare with no label wrapper", () => {
    const { container } = render(<GlassCheckbox aria-label="Bare" />);
    expect(container.querySelector("label")).toBeNull();
    expect(screen.getByRole("checkbox")).toBeDefined();
  });
});

describe("GlassSelect", () => {
  it("forwards its ref to a native select", () => {
    const ref = React.createRef<HTMLSelectElement>();
    render(<GlassSelect ref={ref} label="Theme" options={selectOptions} />);
    const el = screen.getByRole("combobox") as HTMLSelectElement;
    expect(ref.current).toBe(el);
    // Delegation *is* the contract here: it must be a real `<select>`.
    expect(el.tagName).toBe("SELECT");
  });

  it("renders its options and associates its label", () => {
    render(<GlassSelect label="Theme" options={selectOptions} />);
    expect(screen.getByLabelText("Theme").tagName).toBe("SELECT");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: "Beta" })).toBeDefined();
  });

  it("renders a placeholder as a leading disabled option", () => {
    render(<GlassSelect placeholder="Pick one" options={selectOptions} defaultValue="" />);
    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    expect(options).toHaveLength(4);
    expect(options[0].textContent).toBe("Pick one");
    expect(options[0].disabled).toBe(true);
    expect(options[0].value).toBe("");
  });

  it("marks a disabled option as disabled", () => {
    render(
      <GlassSelect options={[...selectOptions, { value: "d", label: "Delta", disabled: true }]} />,
    );
    expect((screen.getByRole("option", { name: "Delta" }) as HTMLOptionElement).disabled).toBe(
      true,
    );
  });

  it("lets children take precedence over options", () => {
    render(
      <GlassSelect options={selectOptions}>
        <option value="x">Only Child</option>
      </GlassSelect>,
    );
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toBe("Only Child");
  });

  it("stays controlled: the prop wins and onValueChange reports the selection", () => {
    const onValueChange = vi.fn();
    render(<GlassSelect options={selectOptions} value="a" onValueChange={onValueChange} />);
    const el = screen.getByRole("combobox") as HTMLSelectElement;

    fireEvent.change(el, { target: { value: "c" } });
    expect(onValueChange).toHaveBeenCalledWith("c");
    expect(el.value).toBe("a");
  });

  it("selects an option when uncontrolled", () => {
    const onValueChange = vi.fn();
    render(<GlassSelect options={selectOptions} defaultValue="a" onValueChange={onValueChange} />);
    const el = screen.getByRole("combobox") as HTMLSelectElement;

    expect(el.value).toBe("a");
    fireEvent.change(el, { target: { value: "b" } });
    expect(el.value).toBe("b");
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("does not intercept keys, so native type-ahead and popup opening survive", () => {
    const onValueChange = vi.fn();
    render(<GlassSelect options={selectOptions} defaultValue="a" onValueChange={onValueChange} />);
    const el = screen.getByRole("combobox");

    // Nothing cancelled and nothing handled: the UA owns every key on this control.
    expect(fireEvent.keyDown(el, { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.keyDown(el, { key: "b" })).toBe(true);
    expect(fireEvent.keyDown(el, { key: " " })).toBe(true);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("changes nothing when disabled", () => {
    render(<GlassSelect disabled options={selectOptions} defaultValue="a" />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
  });

  it("keeps its chevron out of the hit area and out of the accessibility tree", () => {
    const { container } = render(<GlassSelect options={selectOptions} />);
    const chevron = container.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(chevron).not.toBeNull();
    expect(chevron.style.pointerEvents).toBe("none");
  });
});

describe("snapToStep", () => {
  it("clamps into range", () => {
    expect(snapToStep(-5, 0, 10, 1)).toBe(0);
    expect(snapToStep(15, 0, 10, 1)).toBe(10);
  });

  it("snaps onto a grid offset from min", () => {
    expect(snapToStep(7, 1, 21, 5)).toBe(6);
    expect(snapToStep(4, 1, 21, 5)).toBe(6);
  });

  it("never returns a value outside the bounds when the range is not a step multiple", () => {
    expect(snapToStep(9.9, 0, 10, 3)).toBe(9);
    expect(snapToStep(10, 0, 10, 3)).toBe(9);
  });

  it("keeps a fractional step free of float noise", () => {
    expect(snapToStep(0.3, 0, 1, 0.1)).toBe(0.3);
  });

  it("passes a non-positive step through as a plain clamp", () => {
    expect(snapToStep(3.7, 0, 10, 0)).toBe(3.7);
  });
});
