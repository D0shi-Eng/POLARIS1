// العميل المُصنَّف: خمس دوال، ولا دالة سادسة تقبل اسم عملية.
//
// لو وُجدت `call(operation, payload)` عامة في هذا الملف لصار العارض قادرًا على
// التعبير عن استدعاء لا يعرفه أحد، ولضاع نصف معنى «المجموعة مغلقة». المجموعة
// مغلقة هنا كما هي مغلقة في المضيف.

import type {
  DesktopCapabilityAvailabilityResultV1,
  DesktopSettingsDescribeResultV1,
  DesktopSettingsReadResultV1,
  DesktopRuntimeStatusResultV1,
  BootstrapSnapshot,
} from "../generated/types/desktop-result-v1";
import { callOperation, type CallResult } from "./call";
import type { IdFactory, SessionIdentity } from "./envelope";
import type { DesktopOperation } from "./operations";
import type { Transport } from "./transport";

export type { CallResult } from "./call";

export interface ClientOptions {
  readonly transport: Transport;
  readonly identity: SessionIdentity;
  readonly newId?: IdFactory;
  readonly clock?: () => number;
}

export class DesktopIpcClient {
  private readonly transport: Transport;
  private readonly identity: SessionIdentity;
  private readonly newId: IdFactory | undefined;
  private readonly clock: (() => number) | undefined;

  constructor(options: ClientOptions) {
    this.transport = options.transport;
    this.identity = options.identity;
    this.newId = options.newId;
    this.clock = options.clock;
  }

  bootstrap(): Promise<CallResult<BootstrapSnapshot>> {
    return this.call<BootstrapSnapshot>("desktop.bootstrap", {});
  }

  runtimeStatus(): Promise<CallResult<DesktopRuntimeStatusResultV1>> {
    return this.call<DesktopRuntimeStatusResultV1>("desktop.runtime.status", {});
  }

  capabilityAvailability(ids: readonly string[]): Promise<CallResult<DesktopCapabilityAvailabilityResultV1>> {
    return this.call<DesktopCapabilityAvailabilityResultV1>("desktop.capability.availability", {
      capability_ids: [...ids],
    });
  }

  settingsDescribe(sectionIds?: readonly string[]): Promise<CallResult<DesktopSettingsDescribeResultV1>> {
    const payload: Record<string, unknown> = {};
    if (sectionIds !== undefined && sectionIds.length > 0) payload["section_ids"] = [...sectionIds];
    return this.call<DesktopSettingsDescribeResultV1>("desktop.settings.describe", payload);
  }

  settingsRead(sectionId: string, settingIds?: readonly string[]): Promise<CallResult<DesktopSettingsReadResultV1>> {
    const payload: Record<string, unknown> = { section_id: sectionId };
    if (settingIds !== undefined && settingIds.length > 0) payload["setting_ids"] = [...settingIds];
    return this.call<DesktopSettingsReadResultV1>("desktop.settings.read", payload);
  }

  /**
   * خاصّة عمدًا. الخمس أعلاه هي السطح العام، وهذه هي آلتها المشتركة.
   */
  private call<T>(operation: DesktopOperation, payload: Record<string, unknown>): Promise<CallResult<T>> {
    return callOperation<T>(
      { transport: this.transport, identity: this.identity, newId: this.newId, clock: this.clock },
      operation,
      payload,
    );
  }
}
