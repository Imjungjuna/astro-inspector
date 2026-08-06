import { describe, expect, it } from "vitest";
import { formatClipboardPayload } from "../../src/client/clipboard-payload.js";
import type {
  ContextField,
  LocatorSettings,
  RegisterElementResponse
} from "../../src/shared/contracts.js";

const registration: RegisterElementResponse = {
  token: "#a7k9",
  entry: {
    file: "src/components/HospitalListCard.tsx",
    line: 298,
    column: 13,
    sourceTag: "Link",
    domTag: "a"
  },
  workspaceFile:
    "/apps/astro/src/components/HospitalListCard.tsx"
};

function contextSettings(
  contextFields: ContextField[],
  locationFormat: LocatorSettings["locationFormat"] = "path"
): LocatorSettings {
  return {
    schemaVersion: 5,
    triggerKey: "alt",
    colorPreset: "violet",
    parentLevels: 1,
    copyMode: "context",
    contextFields,
    locationFormat
  };
}

describe("formatClipboardPayload", () => {
  it("returns only the exact token in Hash mode", () => {
    expect(
      formatClipboardPayload(registration, {
        ...contextSettings(["tag", "location", "line"], "moduleName"),
        copyMode: "hash"
      })
    ).toBe("#a7k9");
  });

  it("formats one tag when source and DOM tags match", () => {
    expect(
      formatClipboardPayload(
        {
          ...registration,
          entry: {
            ...registration.entry,
            sourceTag: "span",
            domTag: "span"
          }
        },
        contextSettings(["tag"])
      )
    ).toBe("<span>");
  });

  it("formats source-to-DOM tags when they differ", () => {
    expect(
      formatClipboardPayload(registration, contextSettings(["tag"]))
    ).toBe("<Link→a>");
  });

  it.each([
    {
      name: "workspace Path",
      fields: ["location"] as ContextField[],
      format: "path" as const,
      expected: "/apps/astro/src/components/HospitalListCard.tsx"
    },
    {
      name: "Path with Line",
      fields: ["location", "line"] as ContextField[],
      format: "path" as const,
      expected: "/apps/astro/src/components/HospitalListCard.tsx:298:13"
    },
    {
      name: "Module name",
      fields: ["location"] as ContextField[],
      format: "moduleName" as const,
      expected: "HospitalListCard.tsx"
    },
    {
      name: "Module name with Line",
      fields: ["location", "line"] as ContextField[],
      format: "moduleName" as const,
      expected: "HospitalListCard.tsx:298:13"
    },
    {
      name: "Tag with Module name and Line",
      fields: ["tag", "location", "line"] as ContextField[],
      format: "moduleName" as const,
      expected: "<Link→a> | HospitalListCard.tsx:298:13"
    },
    {
      name: "stable order despite reversed settings order",
      fields: ["line", "location", "tag"] as ContextField[],
      format: "path" as const,
      expected:
        "<Link→a> | /apps/astro/src/components/HospitalListCard.tsx:298:13"
    }
  ])("formats $name", ({ fields, format, expected }) => {
    expect(
      formatClipboardPayload(registration, contextSettings(fields, format))
    ).toBe(expected);
  });

  it("rejects an impossible empty Context payload", () => {
    expect(() =>
      formatClipboardPayload(registration, contextSettings([]))
    ).toThrow("Context copy requires");
  });

  it("appends the item label for a repeat instance", () => {
    expect(
      formatClipboardPayload(
        {
          ...registration,
          entry: {
            ...registration.entry,
            instance: 3,
            instanceLabel: "강남 C병원"
          }
        },
        contextSettings(["tag", "location", "line"])
      )
    ).toBe(
      "<Link→a> | /apps/astro/src/components/HospitalListCard.tsx:298:13 | 강남 C병원"
    );
  });

  it("omits the label when the instance has no text", () => {
    expect(
      formatClipboardPayload(
        {
          ...registration,
          entry: {
            ...registration.entry,
            sourceTag: "button",
            domTag: "button",
            instance: 2,
            instanceLabel: ""
          }
        },
        contextSettings(["tag"])
      )
    ).toBe("<button>");
  });

  it("leaves the hash payload untouched for a repeat instance", () => {
    expect(
      formatClipboardPayload(
        {
          ...registration,
          entry: {
            ...registration.entry,
            instance: 3,
            instanceLabel: "강남 C병원"
          }
        },
        { ...contextSettings(["tag"]), copyMode: "hash" }
      )
    ).toBe("#a7k9");
  });
});
