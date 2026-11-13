// رابط التكامل. مجرّد عمدًا: السلسلة لا تعرف كيف تُحسب التجزئة، وإنما تسأل الرابط.
//
// لماذا التجريد قبل الحاجة إليه: البديل الوحيد المقبول لاحقًا هو رابط بمفتاح
// (MAC أو توقيع)، وذلك يغيّر مصدر السر لا شكل السلسلة. جعل الحد هنا يعني أن
// إضافة المفتاح لاحقًا لا تلمس منطق الربط ولا التحقق.
//
// وما لا يفعله هذا الملف: لا يقرأ مفتاحًا، ولا يدّعي وجود واحد، ولا يسمّي
// التجزئة توقيعًا. W5 يشحن رابطًا واحدًا بلا مفتاح، ويقول ذلك باسمه.

import { canonicalize, sha256Hex, withoutTopLevelKey } from "@polaris/contracts";

import type { Doc } from "../../policy/types.js";
import type { ChainLinkInput, IntegrityBinderName } from "./record.js";

export interface IntegrityBinder {
  readonly name: IntegrityBinderName;
  /**
   * هل يعتمد الرابط على سر. false هنا ليس نقصًا مخفيًا بل ادعاء صريح:
   * ما يُبنى بلا سر لا يُقدَّم أبدًا بوصفه عدم إنكار.
   */
  readonly keyed: boolean;
  /** تجزئة محتوى الحدث، بحذف حقل التكامل نفسه — نفس قاعدة العقود حرفيًا. */
  eventHash(event: Doc): string;
  /** تجزئة الحلقة التي تربط السجل بسابقه. */
  linkHash(input: ChainLinkInput): string;
}

/**
 * الرابط الوحيد في W5.
 *
 * الادعاء المُثبَت: تعديل سجل مخزَّن، أو حذفه، أو إدراج سجل، أو إعادة ترتيب،
 * يُكتشف ما لم يُعَد بناء السلسلة كلها من نقطة العطب إلى نهايتها.
 * الادعاء غير المُدَّعى: مقاومة مدير النظام، أو النواة، أو استبدال القرص،
 * أو عدم الإنكار.
 */
export class HashChainOnlyBinder implements IntegrityBinder {
  public readonly name = "HASH_CHAIN_ONLY" as const;
  public readonly keyed = false;

  public eventHash(event: Doc): string {
    return sha256Hex(canonicalize(withoutTopLevelKey(event, "integrity")));
  }

  public linkHash(input: ChainLinkInput): string {
    return sha256Hex(canonicalize(input as unknown as Record<string, unknown>));
  }
}
