// الأجزاء الثابتة لحزمة PowerPoint: السمة والقالب الرئيسي والتخطيط وقالب الملاحظات.
//
// منفصلة عن كاتب الشرائح لأنها نصّ ثابت طويل لا منطق فيه؛ خلطها بالمنطق يجعل
// الملف الواحد يكبر بلا سبب (قاعدة الملفات الصغيرة). ألوان POLARIS هنا: كحلي عميق
// وأزرق نجمي، بلا أي أصل مأخوذ من منتج آخر.

pub const P_NS: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
pub const A_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
pub const R_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
pub const REL_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
pub const REL_TYPE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

pub fn theme_xml(name: &str) -> String {
    let fill = "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>";
    let line = "<a:ln w=\"9525\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln>";
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><a:theme xmlns:a=\"{a}\" name=\"{name}\"><a:themeElements>",
            "<a:clrScheme name=\"POLARIS\"><a:dk1><a:srgbClr val=\"0B1426\"/></a:dk1><a:lt1><a:srgbClr val=\"FFFFFF\"/></a:lt1>",
            "<a:dk2><a:srgbClr val=\"14213D\"/></a:dk2><a:lt2><a:srgbClr val=\"EEF2F8\"/></a:lt2>",
            "<a:accent1><a:srgbClr val=\"3D6FE0\"/></a:accent1><a:accent2><a:srgbClr val=\"22A6B3\"/></a:accent2>",
            "<a:accent3><a:srgbClr val=\"E0A23D\"/></a:accent3><a:accent4><a:srgbClr val=\"7C5CD6\"/></a:accent4>",
            "<a:accent5><a:srgbClr val=\"2FA36B\"/></a:accent5><a:accent6><a:srgbClr val=\"D65C5C\"/></a:accent6>",
            "<a:hlink><a:srgbClr val=\"3D6FE0\"/></a:hlink><a:folHlink><a:srgbClr val=\"7C5CD6\"/></a:folHlink></a:clrScheme>",
            "<a:fontScheme name=\"POLARIS\"><a:majorFont><a:latin typeface=\"Segoe UI Semibold\"/><a:ea typeface=\"\"/><a:cs typeface=\"Arial\"/></a:majorFont>",
            "<a:minorFont><a:latin typeface=\"Segoe UI\"/><a:ea typeface=\"\"/><a:cs typeface=\"Arial\"/></a:minorFont></a:fontScheme>",
            "<a:fmtScheme name=\"POLARIS\"><a:fillStyleLst>{f}{f}{f}</a:fillStyleLst><a:lnStyleLst>{l}{l}{l}</a:lnStyleLst>",
            "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>",
            "<a:bgFillStyleLst>{f}{f}{f}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>"
        ),
        a = A_NS,
        name = name,
        f = fill,
        l = line
    )
}

fn placeholder(id: u32, name: &str, ph: &str, x: i64, y: i64, cx: i64, cy: i64) -> String {
    format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{name}\"/><p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr><p:nvPr>{ph}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang=\"en-US\"/></a:p></p:txBody></p:sp>"
    )
}

pub fn slide_master_xml() -> String {
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><p:sldMaster xmlns:a=\"{a}\" xmlns:r=\"{r}\" xmlns:p=\"{p}\">",
            "<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val=\"FFFFFF\"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>",
            "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>",
            "{title}{body}</p:spTree></p:cSld>",
            "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>",
            "<p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst>",
            "<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz=\"3200\" b=\"1\"><a:solidFill><a:schemeClr val=\"tx2\"/></a:solidFill><a:latin typeface=\"+mj-lt\"/><a:cs typeface=\"+mj-cs\"/></a:defRPr></a:lvl1pPr></p:titleStyle>",
            "<p:bodyStyle><a:lvl1pPr marL=\"285750\" indent=\"-285750\"><a:buFont typeface=\"Arial\"/><a:buChar char=\"&#8226;\"/><a:defRPr sz=\"2000\"><a:solidFill><a:schemeClr val=\"tx1\"/></a:solidFill><a:latin typeface=\"+mn-lt\"/><a:cs typeface=\"+mn-cs\"/></a:defRPr></a:lvl1pPr></p:bodyStyle>",
            "<p:otherStyle><a:lvl1pPr><a:defRPr sz=\"1600\"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>"
        ),
        a = A_NS,
        r = R_NS,
        p = P_NS,
        title = placeholder(2, "Title Placeholder", "<p:ph type=\"title\"/>", 609600, 365760, 10972800, 914400),
        body = placeholder(3, "Body Placeholder", "<p:ph type=\"body\" idx=\"1\"/>", 609600, 1463040, 10972800, 4754880),
    )
}

pub fn slide_layout_xml() -> String {
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><p:sldLayout xmlns:a=\"{a}\" xmlns:r=\"{r}\" xmlns:p=\"{p}\" type=\"obj\" preserve=\"1\">",
            "<p:cSld name=\"Title and Content\"><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>",
            "{title}{body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"
        ),
        a = A_NS,
        r = R_NS,
        p = P_NS,
        title = placeholder(2, "Title 1", "<p:ph type=\"title\"/>", 609600, 365760, 10972800, 914400),
        body = placeholder(3, "Content Placeholder 2", "<p:ph idx=\"1\"/>", 609600, 1463040, 10972800, 4754880),
    )
}

pub fn notes_master_xml() -> String {
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><p:notesMaster xmlns:a=\"{a}\" xmlns:r=\"{r}\" xmlns:p=\"{p}\">",
            "<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{body}</p:spTree></p:cSld>",
            "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>",
            "<p:notesStyle><a:lvl1pPr><a:defRPr sz=\"1200\"/></a:lvl1pPr></p:notesStyle></p:notesMaster>"
        ),
        a = A_NS,
        r = R_NS,
        p = P_NS,
        body = placeholder(2, "Notes Placeholder", "<p:ph type=\"body\" idx=\"1\"/>", 685800, 4343400, 5486400, 4114800),
    )
}

pub fn rels(entries: &[(String, &str, String)]) -> String {
    let mut out = format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"{REL_NS}\">");
    for (id, kind, target) in entries {
        out.push_str(&format!("<Relationship Id=\"{id}\" Type=\"{REL_TYPE}/{kind}\" Target=\"{target}\"/>"));
    }
    out.push_str("</Relationships>");
    out
}

pub const PRES_PROPS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><p:presentationPr xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"/>";
pub const VIEW_PROPS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><p:viewPr xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"><p:normalViewPr><p:restoredLeft sz=\"15620\"/><p:restoredTop sz=\"94660\"/></p:normalViewPr><p:gridSpacing cx=\"76200\" cy=\"76200\"/></p:viewPr>";
pub const TABLE_STYLES: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><a:tblStyleLst xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" def=\"{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}\"/>";
