using TranslateDemo.Domain.ValueObjects;

namespace TranslateDemo.Domain.Abstractions;

public interface ITextExtractor
{
    Task<ExtractedText> ExtractAsync(Stream content, string fileExtension, CancellationToken ct = default);
}

public sealed record ExtractedText(string Text, string? ContentType, string? FileExtension);

