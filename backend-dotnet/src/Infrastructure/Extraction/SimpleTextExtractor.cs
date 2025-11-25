using System.Text;
using DocumentFormat.OpenXml.Packaging;
using TranslateDemo.Domain.Abstractions;

namespace TranslateDemo.Infrastructure.Extraction;

/// <summary>
/// Simplified extractor: reads the stream as UTF-8. Replace with DOCX/PDF-aware extractor in production.
/// </summary>
public sealed class SimpleTextExtractor : ITextExtractor
{
    public async Task<ExtractedText> ExtractAsync(Stream content, string fileExtension, CancellationToken ct = default)
    {
        using var ms = new MemoryStream();
        await content.CopyToAsync(ms, ct);
        ms.Position = 0;

        var ext = (fileExtension ?? string.Empty).ToLowerInvariant();
        if (ext == "docx")
        {
            try
            {
                using var doc = WordprocessingDocument.Open(ms, false);
                var builder = new StringBuilder();
                var paragraphs = doc.MainDocumentPart?.Document?.Body?.Elements<DocumentFormat.OpenXml.Wordprocessing.Paragraph>();
                if (paragraphs != null)
                {
                    foreach (var para in paragraphs)
                    {
                        var paraText = para.InnerText ?? string.Empty;
                        if (!string.IsNullOrWhiteSpace(paraText))
                        {
                            builder.AppendLine(paraText.Trim());
                            builder.AppendLine();
                        }
                    }
                }
                var extracted = builder.ToString().Trim();
                return new ExtractedText(extracted, "text/plain; charset=utf-8", fileExtension);
            }
            catch
            {
                ms.Position = 0; // fall back to UTF-8
            }
        }

        var text = Encoding.UTF8.GetString(ms.ToArray());
        return new ExtractedText(text, "text/plain; charset=utf-8", fileExtension);
    }
}
