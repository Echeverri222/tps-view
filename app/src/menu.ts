import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { addImages, chooseImageForCurrent, deleteCurrentSpecimen, exportCsv, newFromImages, openDialog, relinkMissingImages, saveFile } from "./actions";
import { useStore } from "./store";

const isMac = navigator.userAgent.includes("Mac");
const st = () => useStore.getState();

const isEditingText = () => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
};

const item = (text: string, action: () => unknown, accelerator?: string) => MenuItem.new({ text, accelerator, action: () => void action() });
const sep = () => PredefinedMenuItem.new({ item: "Separator" });

/** Native menu bar. Single-key shortcuts (L, V, S, arrows) live in App's keydown handler instead. */
export async function setupMenu() {
  const app = isMac
    ? [
        await Submenu.new({
          text: "TPS View",
          items: [
            await PredefinedMenuItem.new({ item: { About: { name: "TPS View", version: "0.1.0", license: "MIT", website: "https://echeverri222.github.io/tps-view/", websiteLabel: "echeverri222.github.io/tps-view" } } }),
            await sep(),
            await PredefinedMenuItem.new({ item: "Services" }),
            await sep(),
            await PredefinedMenuItem.new({ item: "Hide" }),
            await PredefinedMenuItem.new({ item: "HideOthers" }),
            await PredefinedMenuItem.new({ item: "ShowAll" }),
            await sep(),
            await PredefinedMenuItem.new({ item: "Quit" }),
          ],
        }),
      ]
    : [];

  const file = await Submenu.new({
    text: "File",
    items: [
      await item("New from Images…", newFromImages, "CmdOrCtrl+N"),
      await item("Open…", openDialog, "CmdOrCtrl+O"),
      await sep(),
      await item("Add Images…", addImages, "CmdOrCtrl+Shift+I"),
      await sep(),
      await item("Save", () => saveFile(), "CmdOrCtrl+S"),
      await item("Save As…", () => saveFile(true), "CmdOrCtrl+Shift+S"),
      await item("Export CSV…", exportCsv, "CmdOrCtrl+E"),
      await sep(),
      await PredefinedMenuItem.new({ item: "CloseWindow" }),
      ...(isMac ? [] : [await PredefinedMenuItem.new({ item: "Quit" })]),
    ],
  });

  const edit = await Submenu.new({
    text: "Edit",
    items: [
      await item("Undo", () => (isEditingText() ? document.execCommand("undo") : st().undo()), "CmdOrCtrl+Z"),
      await item("Redo", () => (isEditingText() ? document.execCommand("redo") : st().redo()), "CmdOrCtrl+Shift+Z"),
      await sep(),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
    ],
  });

  const view = await Submenu.new({
    text: "View",
    items: [
      await item("Zoom In", () => st().requestView("in"), "CmdOrCtrl+="),
      await item("Zoom Out", () => st().requestView("out"), "CmdOrCtrl+-"),
      await item("Fit Image", () => st().requestView("fit"), "CmdOrCtrl+0"),
      await item("Actual Pixels", () => st().requestView("actual"), "CmdOrCtrl+1"),
      await sep(),
      await item("Toggle Magnifier", () => st().set({ magnifier: !st().magnifier })),
      await item("Scale Table…", () => st().set({ modal: "scales" }), "CmdOrCtrl+T"),
      await item("Check Dataset…", () => st().set({ modal: "issues" }), "CmdOrCtrl+Shift+K"),
    ],
  });

  const specimen = await Submenu.new({
    text: "Specimen",
    items: [
      await item("Previous Specimen", () => st().setCurrent(st().current - 1), "CmdOrCtrl+["),
      await item("Next Specimen", () => st().setCurrent(st().current + 1), "CmdOrCtrl+]"),
      await sep(),
      await item("Choose Image…", chooseImageForCurrent, "CmdOrCtrl+I"),
      await item("Relink Missing Images…", relinkMissingImages),
      await sep(),
      await item("Measure Scale", () => st().setTool("scale")),
      await item("Delete Specimen…", deleteCurrentSpecimen),
    ],
  });

  const window = await Submenu.new({
    text: "Window",
    items: [await PredefinedMenuItem.new({ item: "Minimize" }), await PredefinedMenuItem.new({ item: "Fullscreen" })],
  });

  const menu = await Menu.new({ items: [...app, file, edit, view, specimen, window] });
  await menu.setAsAppMenu();
}
