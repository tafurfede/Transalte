namespace TranslateDemo.Domain.Abstractions;

public interface ILanguageDetector
{
    Task<string?> DetectCodeAsync(string text, CancellationToken ct = default);
}

