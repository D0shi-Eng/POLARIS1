// مسار غير معروف.
//
// الفشل آمن: الشريط الجانبي يبقى، والمستخدم يعود بضغطة. لا إعادة توجيه صامتة إلى
// الرئيسية، لأن إخفاء الخطأ يجعل الرابط المكسور يعيش أطول.

import { useNavigation, useTranslator } from "../app/context";
import { HOME_ROUTE } from "../routes/registry";
import { StateBlock } from "../ui/components/StateBlock";

export function NotFoundScreen({ requestedPath }: { readonly requestedPath: string }) {
  const navigation = useNavigation();
  const translator = useTranslator();
  return (
    <>
      <h1 className="page-title">{translator.t("route.unknown.title")}</h1>
      <StateBlock
        kind="empty"
        titleKey="route.unknown.title"
        bodyKey="route.unknown.body"
        bodyValues={{ route: requestedPath }}
        action={{ labelKey: "route.unknown.action", onSelect: () => navigation.navigate(HOME_ROUTE.path) }}
      />
    </>
  );
}
