using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>وصف حقل واحد من الحمولة بلا قيمته: اسم ونوع وبصمة وحُكم.</summary>
    internal sealed class ProtocolFieldReport
    {
        public string Name = "";
        public bool Present;
        public string Kind = "";
        public bool Valid;
        public int ItemCount = -1;
        public string ValueSha256Prefix = "";
        public string Detail = "";
    }

    /// <summary>
    /// عقد مدخل منفّذ W4، مفروضًا قبل الكتابة على stdin لا بعد صمت الابن.
    ///
    /// العيب الذي يغلقه: كانت الحمولة تُبنى وتُكتب بلا فحص، فإن رفضها المنفّذ ظهر
    /// ذلك خطأ حصر لا خطأ بروتوكول. ومن يقرأ الدليل لم يكن يرى ماذا أُرسل أصلًا.
    /// هنا تُفحص الحمولة على العقد نفسه الذي يفهمه المنفّذ، ويُسجَّل شكلها كاملًا
    /// بلا قيمة واحدة: الأسماء والأنواع وبصمات القيم فقط.
    /// </summary>
    internal sealed class ProtocolPayloadContract
    {
        internal const string ReasonMalformed = "PROTOCOL_PAYLOAD_NOT_JSON";
        internal const string ReasonInvalid = "PROTOCOL_PAYLOAD_CONTRACT_VIOLATION";

        private static readonly string[] RequiredIdentifiers = new string[] {
            "grant_id", "correlation_id", "invocation_id", "decision_id" };
        private static readonly string[] KnownMembers = new string[] {
            "grant_id", "correlation_id", "invocation_id", "decision_id", "operation", "target",
            "allowed_host_roots", "max_bytes", "deadline_ms", "encoding", "payload_base64",
            "allow_overwrite", "environment_contract" };

        private readonly List<ProtocolFieldReport> _fields = new List<ProtocolFieldReport>();
        private readonly List<string> _violations = new List<string>();

        public bool Valid;
        public string ReasonCode = "";
        public int ByteLength;

        public IEnumerable<string> Violations { get { return _violations; } }

        /// <summary>يفحص الحمولة على العقد. يعيد true فقط إن صحّ كل حقل مطلوب.</summary>
        public bool Validate(string payload)
        {
            ByteLength = payload == null ? 0 : Encoding.UTF8.GetByteCount(payload);
            string error;
            JsonValue document = JsonReader.Parse(payload, out error);
            if (document == null)
            {
                ReasonCode = ReasonMalformed;
                _violations.Add("the payload is not a JSON document: " + error);
                return false;
            }
            if (!document.IsObject)
            {
                ReasonCode = ReasonInvalid;
                _violations.Add("the payload root is " + document.Kind + ", not an object");
                return false;
            }

            for (int i = 0; i < RequiredIdentifiers.Length; i++)
            {
                RequireNonEmptyString(document, RequiredIdentifiers[i]);
            }
            RequireEnumeration(document, "operation", new string[] { "READ_FILE", "WRITE_FILE" });

            ProtocolFieldReport target = Describe(document, "target");
            JsonValue targetValue = document.Member("target");
            if (targetValue == null || !targetValue.IsObject)
            {
                target.Valid = false;
                target.Detail = "target must be an object carrying logical, host and mode";
                _violations.Add("target is missing or is not an object");
            }
            else
            {
                bool logical = targetValue.MemberText("logical").Length > 0;
                bool host = targetValue.MemberText("host").Length > 0;
                string mode = targetValue.MemberText("mode");
                bool modeValid = mode == "READ" || mode == "CREATE" || mode == "MODIFY";

                // هوية الكائن جزء من العقد لا زينة: بدونها لا يستطيع المنفّذ أن
                // يثبت أن ما فتحه هو ما أُقرّ، فيفشل مغلقًا. والقراءة تشترطها.
                JsonValue identityValue = targetValue.Member("identity");
                bool identityPresent = identityValue != null && identityValue.IsObject;
                string identityVolume = identityPresent ? identityValue.MemberText("volume") : "";
                string identityFile = identityPresent ? identityValue.MemberText("file") : "";
                bool identityValid = identityPresent && identityVolume.Length > 0
                    && identityFile.Length > 0 && identityFile != "0";
                bool identityRequired = document.MemberText("operation") == "READ_FILE";

                target.Valid = logical && host && modeValid && (identityValid || !identityRequired);
                target.Detail = "logical=" + logical.ToString() + " host=" + host.ToString()
                    + " mode_valid=" + modeValid.ToString()
                    + " identity_present=" + identityPresent.ToString()
                    + " identity_valid=" + identityValid.ToString();
                if (!target.Valid)
                {
                    _violations.Add("target.logical, target.host, target.mode and - for a read - target.identity must all be valid");
                }
            }

            ProtocolFieldReport roots = Describe(document, "allowed_host_roots");
            JsonValue rootsValue = document.Member("allowed_host_roots");
            if (rootsValue == null || !rootsValue.IsArray || rootsValue.Items.Count == 0)
            {
                roots.Valid = false;
                _violations.Add("allowed_host_roots must be a non-empty array of strings");
            }
            else
            {
                bool allStrings = true;
                for (int i = 0; i < rootsValue.Items.Count; i++)
                {
                    if (!rootsValue.Items[i].IsString || rootsValue.Items[i].Text.Length == 0) { allStrings = false; }
                }
                roots.Valid = allStrings;
                roots.ItemCount = rootsValue.Items.Count;
                if (!allStrings) { _violations.Add("every allowed_host_roots entry must be a non-empty string"); }
            }

            RequirePositiveNumber(document, "max_bytes");
            RequirePositiveNumber(document, "deadline_ms");
            RequireEnumeration(document, "encoding", new string[] { "utf-8" });

            ProtocolFieldReport overwrite = Describe(document, "allow_overwrite");
            JsonValue overwriteValue = document.Member("allow_overwrite");
            overwrite.Valid = overwriteValue != null && overwriteValue.IsBoolean;
            if (!overwrite.Valid) { _violations.Add("allow_overwrite must be a boolean"); }

            // الاختياريان: يُفحصان إن حضرا، ولا يُطلبان.
            JsonValue payloadBase64 = document.Member("payload_base64");
            if (payloadBase64 != null)
            {
                ProtocolFieldReport report = Describe(document, "payload_base64");
                report.Valid = payloadBase64.IsString;
                if (!report.Valid) { _violations.Add("payload_base64, when present, must be a string"); }
            }
            JsonValue environment = document.Member("environment_contract");
            if (environment != null)
            {
                ProtocolFieldReport report = Describe(document, "environment_contract");
                bool allStrings = environment.IsObject;
                if (environment.IsObject)
                {
                    foreach (KeyValuePair<string, JsonValue> entry in environment.Members)
                    {
                        if (!entry.Value.IsString) { allStrings = false; }
                    }
                    report.ItemCount = environment.Members.Count;
                }
                report.Valid = allStrings;
                if (!report.Valid) { _violations.Add("environment_contract, when present, must map names to strings"); }
            }

            // حقل لم يعلنه العقد يعني أن المُطلِق يخترع بروتوكولًا. عيب مُطلِق لا تسامح.
            foreach (KeyValuePair<string, JsonValue> entry in document.Members)
            {
                bool known = false;
                for (int i = 0; i < KnownMembers.Length; i++)
                {
                    if (string.Equals(KnownMembers[i], entry.Key, StringComparison.Ordinal)) { known = true; }
                }
                if (!known) { _violations.Add("the payload carries a member the executor contract does not declare: " + entry.Key); }
            }

            Valid = _violations.Count == 0;
            ReasonCode = Valid ? "" : ReasonInvalid;
            return Valid;
        }

        private void RequireNonEmptyString(JsonValue document, string name)
        {
            ProtocolFieldReport report = Describe(document, name);
            JsonValue value = document.Member(name);
            report.Valid = value != null && value.IsString && value.Text.Length > 0;
            if (!report.Valid) { _violations.Add(name + " must be a non-empty string"); }
        }

        private void RequireEnumeration(JsonValue document, string name, string[] allowed)
        {
            ProtocolFieldReport report = Describe(document, name);
            JsonValue value = document.Member(name);
            bool valid = false;
            if (value != null && value.IsString)
            {
                for (int i = 0; i < allowed.Length; i++)
                {
                    if (string.Equals(allowed[i], value.Text, StringComparison.Ordinal)) { valid = true; }
                }
            }
            report.Valid = valid;
            if (!valid) { _violations.Add(name + " must be one of the values the executor contract declares"); }
        }

        private void RequirePositiveNumber(JsonValue document, string name)
        {
            ProtocolFieldReport report = Describe(document, name);
            JsonValue value = document.Member(name);
            report.Valid = value != null && value.IsNumber && value.Number > 0;
            if (!report.Valid) { _violations.Add(name + " must be a positive number"); }
        }

        private ProtocolFieldReport Describe(JsonValue document, string name)
        {
            ProtocolFieldReport report = new ProtocolFieldReport();
            report.Name = name;
            JsonValue value = document.Member(name);
            report.Present = value != null;
            report.Kind = value == null ? "ABSENT" : value.Kind;
            if (value != null && value.IsArray) { report.ItemCount = value.Items.Count; }
            if (value != null && value.IsObject) { report.ItemCount = value.Members.Count; }
            report.ValueSha256Prefix = Fingerprint(value);
            _fields.Add(report);
            return report;
        }

        /// <summary>بصمة قصيرة للقيمة. تُثبت الثبات ولا تكشف محتوى.</summary>
        private static string Fingerprint(JsonValue value)
        {
            if (value == null) { return ""; }
            string canonical = value.IsString || value.IsNumber
                ? value.Text
                : value.IsBoolean ? value.Boolean.ToString() : value.Kind;
            using (SHA256 algorithm = SHA256.Create())
            {
                byte[] digest = algorithm.ComputeHash(Encoding.UTF8.GetBytes(canonical));
                StringBuilder text = new StringBuilder();
                for (int i = 0; i < 8; i++) { text.Append(digest[i].ToString("x2", CultureInfo.InvariantCulture)); }
                return text.ToString();
            }
        }

        internal void Emit(JsonWriter json, string name)
        {
            json.Name(name).BeginObject();
            json.Property("valid", Valid);
            json.Property("reason_code", ReasonCode);
            json.Property("byte_length", ByteLength);
            json.Property("values_redacted", true);
            json.Name("fields").BeginArray();
            for (int i = 0; i < _fields.Count; i++)
            {
                ProtocolFieldReport field = _fields[i];
                json.BeginObject();
                json.Property("name", field.Name);
                json.Property("present", field.Present);
                json.Property("kind", field.Kind);
                json.Property("valid", field.Valid);
                json.Property("item_count", field.ItemCount);
                json.Property("value_sha256_prefix", field.ValueSha256Prefix);
                json.Property("detail", field.Detail);
                json.EndObject();
            }
            json.EndArray();
            json.Property("violations", _violations);
            json.EndObject();
        }
    }

    /// <summary>
    /// استجابة المنفّذ، محلَّلة لا مُلتمَسة بالبحث النصي. status في الجذر أو لا شيء.
    /// </summary>
    internal sealed class ProtocolResponse
    {
        public bool Parsed;
        public string ParseError = "";
        public string Status = "";
        public string ErrorCode = "";
        public bool HasStatus;

        public bool Spoke { get { return Parsed && HasStatus; } }
        public bool Succeeded { get { return Spoke && Status == "SUCCESS"; } }
        public bool Failed { get { return Spoke && Status == "FAILED"; } }

        public static ProtocolResponse Parse(string standardOutput)
        {
            ProtocolResponse response = new ProtocolResponse();
            string text = standardOutput == null ? "" : standardOutput.Trim();
            if (text.Length == 0)
            {
                response.ParseError = "the executor wrote nothing to its protocol stream";
                return response;
            }
            string error;
            JsonValue document = JsonReader.Parse(text, out error);
            if (document == null)
            {
                response.ParseError = error;
                return response;
            }
            response.Parsed = true;
            if (!document.IsObject)
            {
                response.ParseError = "the protocol response root is " + document.Kind + ", not an object";
                return response;
            }
            JsonValue status = document.Member("status");
            if (status != null && status.IsString)
            {
                response.HasStatus = true;
                response.Status = status.Text;
            }
            JsonValue failure = document.Member("error");
            if (failure != null && failure.IsObject) { response.ErrorCode = failure.MemberText("code"); }
            return response;
        }

        internal void Emit(JsonWriter json, string name)
        {
            json.Name(name).BeginObject();
            json.Property("parsed", Parsed);
            json.Property("parse_error", ParseError);
            json.Property("has_status", HasStatus);
            json.Property("status", Status);
            json.Property("error_code", ErrorCode);
            json.Property("parsed_not_substring_matched", true);
            json.EndObject();
        }
    }
}
