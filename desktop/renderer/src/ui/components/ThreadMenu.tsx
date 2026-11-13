// قائمة «⋯» للمهمة كما في مانوس: إعادة تسمية، تثبيت، مفضّلة، نقل إلى المشروع، أرشيف، حذف.
//
// كل بند نداء مضيف واحد (`conversation.update` أو `conversation.delete`) يُطبَّق على المحادثة كلّها، ثم
// إشعار يعيد به الشريط والصفحات القراءة. لا شيء يُعرض ناجحًا قبل جواب المضيف؛ والفشل يُعرض بنصّه.
// «مشاركة» في مانوس ليست هنا: POLARIS لا يرفع المحادثات إلى خدمة مشاركة، فلا بند يوحي بذلك.

import { useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import type { Phase02Client } from "../../ipc/p02-client";
import type { Phase08Client } from "../../ipc/p08-client";
import type { ProjectListResultV1 } from "../../generated/types/desktop-p02-result-v1";
import { errorText, notifyThreadsChanged, type ThreadState } from "../../p08/threads";
import { ClearableInput, Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { MenuItem, MenuSeparator, Popover } from "./Popover";
import { ProjectDialog } from "./ProjectDialogs";

type Project = ProjectListResultV1["projects"][number];
type Changes = Parameters<Phase08Client["updateConversation"]>[1];

export interface ThreadMenuProps {
  readonly thread: ThreadState;
  readonly phase08: Phase08Client;
  readonly phase02?: Phase02Client | undefined;
  readonly projects: readonly Project[];
  readonly triggerClassName?: string;
  readonly placement?: "up" | "down";
  readonly align?: "start" | "end";
  /** «نقل إلى المشروع» قائمة جانبية (الشريط) أو قسم داخل القائمة (حين لا يتّسع الجانب). */
  readonly moveAs?: "flyout" | "inline";
  /** يُستدعى بعد حذف ناجح (الصفحة المفتوحة على المحادثة تعود إلى الرئيسية). */
  onDeleted?(): void;
  onOpenChange?(open: boolean): void;
}

export function ThreadMenu({ thread, phase08, phase02, projects, triggerClassName = "icon-button", placement = "down", align = "end", moveAs = "flyout", onDeleted, onOpenChange }: ThreadMenuProps) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const [moving, setMoving] = useState(false);
  const [dialog, setDialog] = useState<"rename" | "delete" | "project" | null>(null);
  const [title, setTitle] = useState(thread.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function update(changes: Changes): Promise<boolean> {
    const result = await phase08.updateConversation(thread.thread_id, changes);
    if (!result.ok) {
      setNotice(errorText(translator, result.error));
      return false;
    }
    notifyThreadsChanged();
    return true;
  }

  function close(): void {
    setDialog(null);
    setError(null);
    setBusy(false);
  }

  async function rename(): Promise<void> {
    setBusy(true);
    const result = await phase08.updateConversation(thread.thread_id, { title: title.trim() });
    if (!result.ok) {
      setBusy(false);
      setError(errorText(translator, result.error));
      return;
    }
    notifyThreadsChanged();
    close();
  }

  async function remove(): Promise<void> {
    setBusy(true);
    const result = await phase08.deleteConversation(thread.thread_id);
    if (!result.ok) {
      setBusy(false);
      setError(errorText(translator, result.error));
      return;
    }
    close();
    notifyThreadsChanged();
    if (onDeleted !== undefined) onDeleted();
    else navigation.navigate("/");
  }

  const activeProjects = projects.filter((p) => p.status === "ACTIVE");
  const moveTargets = (
    <>
      <MenuItem icon={<Icon name="plus" size={16} />} label={translator.t("ui.thread.move_new")} disabled={phase02 === undefined} onSelect={() => setDialog("project")} />
      {activeProjects.length === 0 ? null : <MenuSeparator />}
      {activeProjects.map((p) => (
        <MenuItem
          key={p.project_id}
          icon={<Icon name="projects" size={16} />}
          label={p.name}
          trailing={p.project_id === thread.project_id ? <Icon name="check" size={15} /> : undefined}
          onSelect={() => void update({ project_id: p.project_id === thread.project_id ? null : p.project_id })}
        />
      ))}
      {thread.project_id === undefined ? null : (
        <>
          <MenuSeparator />
          <MenuItem icon={<Icon name="close" size={16} />} label={translator.t("ui.thread.move_out")} onSelect={() => void update({ project_id: null })} />
        </>
      )}
    </>
  );

  return (
    <>
      <Popover
        label={translator.t("ui.thread.menu")}
        trigger={<Icon name="more" size={16} />}
        triggerClassName={triggerClassName}
        placement={placement}
        align={align}
        className="thread-menu"
        floating
        onOpenChange={(open) => {
          if (!open) setMoving(false);
          onOpenChange?.(open);
        }}
      >
        <MenuItem
          icon={<Icon name="edit" size={16} />}
          label={translator.t("ui.thread.rename")}
          onSelect={() => {
            setTitle(thread.title);
            setDialog("rename");
          }}
        />
        <MenuSeparator />
        <MenuItem icon={<Icon name="pin" size={16} />} label={translator.t(thread.pinned ? "ui.thread.unpin" : "ui.thread.pin")} onSelect={() => void update({ pinned: !thread.pinned })} />
        <MenuItem icon={<Icon name="star" size={16} />} label={translator.t(thread.favorite ? "ui.thread.unfavorite" : "ui.thread.favorite")} onSelect={() => void update({ favorite: !thread.favorite })} />
        <div className={moving && moveAs === "flyout" ? "menu-sub is-open" : "menu-sub"}>
          <MenuItem
            icon={<Icon name="folder-move" size={16} />}
            label={translator.t("ui.thread.move")}
            trailing={<Icon name="chevron" size={14} className="menu-sub__chevron" />}
            keepOpen
            onSelect={() => setMoving((open) => !open)}
          />
          {moving ? (
            <div className={moveAs === "flyout" ? "popover__menu menu-flyout" : "menu-inline"} role="menu" aria-label={translator.t("ui.thread.move")}>
              {moveTargets}
            </div>
          ) : null}
        </div>
        <MenuSeparator />
        <MenuItem icon={<Icon name="archive" size={16} />} label={translator.t(thread.archived ? "ui.thread.unarchive" : "ui.thread.archive")} onSelect={() => void update({ archived: !thread.archived })} />
        <MenuSeparator />
        <MenuItem icon={<Icon name="trash" size={16} />} label={translator.t("ui.thread.delete")} danger onSelect={() => setDialog("delete")} />
      </Popover>

      {dialog === "rename" ? (
        <Dialog
          title={translator.t("ui.thread.rename_title")}
          hint={translator.t("ui.thread.rename_hint")}
          confirmLabel={translator.t("ui.thread.confirm")}
          canConfirm={title.trim() !== "" && title.trim() !== thread.title}
          busy={busy}
          error={error}
          className="mdialog--small"
          onConfirm={() => void rename()}
          onClose={close}
        >
          <ClearableInput id="thread-title" value={title} maxLength={120} onChange={setTitle} onEnter={() => title.trim() !== "" && void rename()} />
        </Dialog>
      ) : null}

      {dialog === "delete" ? (
        <Dialog
          title={translator.t("ui.thread.delete_title")}
          hint={translator.t("ui.thread.delete_body", { title: thread.title })}
          confirmLabel={translator.t("ui.thread.delete")}
          danger
          busy={busy}
          error={error}
          className="mdialog--small"
          onConfirm={() => void remove()}
          onClose={close}
        />
      ) : null}

      {dialog === "project" && phase02 !== undefined ? (
        <ProjectDialog
          phase02={phase02}
          onClose={close}
          onSaved={(projectId) => {
            close();
            void update({ project_id: projectId });
          }}
        />
      ) : null}

      {notice === null ? null : (
        <Dialog title={translator.t("ui.thread.menu")} hint={notice} confirmLabel={translator.t("ui.close")} className="mdialog--small" single onConfirm={() => setNotice(null)} onClose={() => setNotice(null)} />
      )}
    </>
  );
}
