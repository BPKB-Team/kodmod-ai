from accessibility.math_speech import normalize_math_speech


def test_indonesian_arithmetic_is_spoken_as_words():
    assert normalize_math_speech("3 + 4 = 7") == "3 ditambah 4 sama dengan 7"
    assert normalize_math_speech("9 - 4 = 5") == "9 dikurangi 4 sama dengan 5"


def test_indonesian_grouped_numbers_and_decimals_are_unambiguous():
    assert normalize_math_speech("Nilainya 1.250,75 dari 2.000 siswa.") == (
        "Nilainya 1250 koma 7 5 dari 2000 siswa."
    )
    assert normalize_math_speech("Nilainya 3.14.") == "Nilainya 3 koma 1 4."


def test_indonesian_product_and_file_abbreviations_are_spoken_clearly():
    text = "Tutor AI KODMOD membaca berkas PDF dan DOCX melalui API."
    spoken = normalize_math_speech(text)
    assert spoken == (
        "Tutor kecerdasan buatan Kodmod membaca berkas pe de ef dan "
        "dokumen Word melalui a pe i."
    )
    assert normalize_math_speech(spoken) == spoken
    assert normalize_math_speech("Biaya 1.250 USD, waktu 250 ms.") == (
        "Biaya 1250 dolar Amerika, waktu 250 milidetik."
    )


def test_english_speech_keeps_english_decimal_conventions():
    assert normalize_math_speech("3.14 + 2 = 5", language="en") == "3 point 1 4 plus 2 equals 5"
