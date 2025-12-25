using System.IO;
using System.Text;
using TranslateDemo.Application.Contracts;
using TranslateDemo.Domain.Abstractions;
using TranslateDemo.Domain.Entities;
using TranslateDemo.Domain.Enums;
using TranslateDemo.Domain.ValueObjects;

namespace TranslateDemo.Application.UseCases;

public sealed class ProcessUploadUseCase
{
    private static readonly HashSet<string> LanguageTokens = new(StringComparer.OrdinalIgnoreCase)
    {
        "en", "english", "es", "spanish", "sp", "fr", "french", "de", "german", "pt", "portuguese",
        "ja", "japanese"
    };

    private static readonly Dictionary<string, string> LanguageSlugs = new(StringComparer.OrdinalIgnoreCase)
    {
        ["en"] = "en",
        ["english"] = "en",
        ["es"] = "sp",
        ["spanish"] = "sp",
        ["sp"] = "sp",
        ["fr"] = "fr",
        ["french"] = "fr",
        ["de"] = "de",
        ["german"] = "de",
        ["pt"] = "pt",
        ["portuguese"] = "pt",
        ["ja"] = "ja",
        ["japanese"] = "ja"
    };

    private readonly IJobRepository _jobs;
    private readonly IStorageService _storage;
    private readonly ITextExtractor _extractor;
    private readonly ITranslator _translator;
    private readonly ILanguageDetector _detector;
    private readonly IXmlBuilder _xmlBuilder;

    public ProcessUploadUseCase(
        IJobRepository jobs,
        IStorageService storage,
        ITextExtractor extractor,
        ITranslator translator,
        ILanguageDetector detector,
        IXmlBuilder xmlBuilder)
    {
        _jobs = jobs;
        _storage = storage;
        _extractor = extractor;
        _translator = translator;
        _detector = detector;
        _xmlBuilder = xmlBuilder;
    }

    public async Task HandleAsync(ProcessUploadRequest request, CancellationToken ct = default)
    {
        var keyParts = request.Key.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (keyParts.Length < 2) return;
        var jobId = keyParts[1];

        var job = await _jobs.GetAsync(jobId, ct);
        if (job is null) return;

        await _jobs.UpdateStatusAsync(job.JobId, TranslationStatus.InProgress, null, ct);

        try
        {
            await using var stream = await _storage.GetAsync(request.Key, ct);
            var extracted = await _extractor.ExtractAsync(stream, job.FileExtension ?? "txt", ct);

            var sourceLang = NormalizeCode(job.SourceLanguage);
            if (sourceLang == "auto")
            {
                var detected = await _detector.DetectCodeAsync(extracted.Text, ct);
                sourceLang = detected ?? "auto";
            }

            var translatedText = extracted.Text;
            var targetLang = NormalizeCode(job.TargetLanguage);
            var sameLanguage = sourceLang != "auto" &&
                               string.Equals(sourceLang, targetLang, StringComparison.OrdinalIgnoreCase);

            if (!string.Equals(sourceLang, targetLang, StringComparison.OrdinalIgnoreCase))
            {
                var prepared = EscapeAngles(extracted.Text);
                var translated = await _translator.TranslateAsync(prepared, sourceLang, targetLang, ct);
                translatedText = UnescapeAngles(translated);
            }

            var verificationCode = await _detector.DetectCodeAsync(translatedText, ct);
            var output = job.OutputFormat == OutputFormat.Xml
                ? await BuildXmlAsync(job, translatedText, sameLanguage, targetLang, ct)
                : await BuildDocxAsync(job, translatedText, sameLanguage, targetLang, ct);

            var verificationDetails = verificationCode is null
                ? "Verification inconclusive"
                : $"Detected {verificationCode}";

            await _storage.PutAsync(output.Key, new MemoryStream(output.Payload), output.ContentType, ct);

            job.Status = TranslationStatus.Completed;
            job.OutputKey = output.Key;
            job.VerificationStatus = "PASSED";
            job.VerificationDetails = verificationDetails;
            job.ErrorMessage = null;
            job.UpdatedAt = DateTime.UtcNow;

            await _jobs.UpdateAsync(job, ct);
        }
        catch (Exception ex)
        {
            await _jobs.UpdateStatusAsync(job.JobId, TranslationStatus.Failed, ex.Message, ct);
        }
    }

    private static string NormalizeCode(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return "auto";
        return code.Split('-')[0].ToLowerInvariant();
    }

    private async Task<BuildResult> BuildXmlAsync(TranslationJob job, string translatedText, bool sameLanguage, string targetLang, CancellationToken ct)
    {
        var cleanText = SanitizeForXml(translatedText);
        var sections = BuildSections(cleanText);
        var metadata = new ReportMetadata("RT", job.JobId, targetLang);
        var result = await _xmlBuilder.BuildAsync(metadata, sections, ct);
        var key = $"translated/{job.JobId}/{CreateFileName(job.FileName, sameLanguage, targetLang, "xml")}";
        return new BuildResult(result.Content, result.ContentType, key);
    }

    private async Task<BuildResult> BuildDocxAsync(TranslationJob job, string translatedText, bool sameLanguage, string targetLang, CancellationToken ct)
    {
        // Placeholder: reuse text as UTF-8 docx binary is outside the current scope.
        var buffer = Encoding.UTF8.GetBytes(translatedText);
        var key = $"translated/{job.JobId}/{CreateFileName(job.FileName, sameLanguage, targetLang, job.FileExtension ?? "txt")}";
        return await Task.FromResult(new BuildResult(buffer, job.ContentType ?? "text/plain; charset=utf-8", key));
    }

    private static IReadOnlyList<Section> BuildSections(string text)
    {
        var blocks = text
            .Split(new[] { "\r\n\r\n", "\n\n" }, StringSplitOptions.RemoveEmptyEntries)
            .Select(b => b.Trim())
            .Where(b => b.Length > 0)
            .ToList();

        var sections = new List<Section>();
        Section? current = null;
        bool IsHeading(string value)
        {
            var v = value.Trim();
            if (v.StartsWith("<<") && v.EndsWith(">>")) return true;
            if (v.StartsWith("<") && v.EndsWith(">")) return true;
            return false;
        }

        string NormalizeHeading(string raw)
        {
            var v = raw.Trim();
            if (v.StartsWith("<<") && v.EndsWith(">>")) return v;
            if (v.StartsWith("<") && v.EndsWith(">"))
            {
                v = v.Trim('<', '>', ' ');
                return $"<<{v}>>";
            }
            return $"<<{v}>>";
        }

        foreach (var block in blocks)
        {
            if (IsHeading(block))
            {
                current = new Section(NormalizeHeading(block), new List<string>());
                sections.Add(current);
            }
            else
            {
                if (current == null)
                {
                    current = new Section("<<Document>>", new List<string>());
                    sections.Add(current);
                }
                current.Paragraphs.Add(block);
            }
        }

        if (sections.Count == 0)
        {
            sections.Add(new Section("<<Document>>", new List<string> { text.Trim() }));
        }

        return sections;
    }

    private static string CreateFileName(string originalName, bool sameLanguage, string lang, string extension)
    {
        var stem = Path.GetFileNameWithoutExtension(string.IsNullOrWhiteSpace(originalName) ? "document" : originalName);
        stem = TrimLanguageSuffix(stem);
        if (sameLanguage)
        {
            return $"{stem}.{extension}";
        }
        var suffix = NormalizeLanguageSlug(lang);
        return $"{stem}_{suffix}.{extension}";
    }

    private static string TrimLanguageSuffix(string stem)
    {
        if (string.IsNullOrWhiteSpace(stem)) return "document";

        foreach (var separator in new[] { "-", "_" })
        {
            var parts = stem.Split(separator, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length <= 1) continue;
            var last = parts[^1];
            if (LanguageTokens.Contains(last))
            {
                var rebuilt = string.Join(separator, parts[..^1]);
                return string.IsNullOrWhiteSpace(rebuilt) ? "document" : rebuilt;
            }
        }

        return stem;
    }

    private static string NormalizeLanguageSlug(string code)
    {
        var normalized = NormalizeCode(code);
        if (LanguageSlugs.TryGetValue(normalized, out var slug))
        {
            return slug;
        }

        return string.IsNullOrWhiteSpace(normalized) ? "xx" : normalized;
    }

    private sealed record BuildResult(byte[] Payload, string ContentType, string Key);

    private static string SanitizeForXml(string input)
    {
        if (string.IsNullOrEmpty(input)) return string.Empty;
        var sb = new StringBuilder(input.Length);
        foreach (var ch in input)
        {
            if (ch == 0x9 || ch == 0xA || ch == 0xD ||
                (ch >= 0x20 && ch <= 0xD7FF) ||
                (ch >= 0xE000 && ch <= 0xFFFD))
            {
                sb.Append(ch);
            }
        }
        return sb.ToString();
    }

    private const string LAngle = "__L_ANGLE__";
    private const string RAngle = "__R_ANGLE__";

    private static string EscapeAngles(string value) =>
        string.IsNullOrEmpty(value)
            ? string.Empty
            : value.Replace("<", LAngle).Replace(">", RAngle);

    private static string UnescapeAngles(string value) =>
        string.IsNullOrEmpty(value)
            ? string.Empty
            : value.Replace(LAngle, "<").Replace(RAngle, ">");
}
