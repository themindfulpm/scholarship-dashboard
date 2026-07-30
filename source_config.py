"""Configurable source catalog and criteria for rules-based scholarship auto-pull."""

from __future__ import annotations

SOURCE_CATALOG = [
    {
        "school": "Morgan State University",
        "country": "US",
        "enabled": True,
        "url": "https://www.morgan.edu/financial-aid/scholarships",
        "urls": [
            "https://www.morgan.edu/financial-aid/scholarships",
            "https://www.morgan.edu/office-of-financial-aid",
        ],
        "priority": "high",
        "school_type": "HBCU",
    },
    {
        "school": "Kennesaw State University",
        "country": "US",
        "enabled": True,
        "url": "https://www.kennesaw.edu/financial-aid/",
        "urls": [
            "https://www.kennesaw.edu/financial-aid/",
            "https://www.kennesaw.edu/financial-aid/types-of-aid/scholarships.php",
            "https://campus.kennesaw.edu/current-students/financial-aid/",
        ],
        "priority": "medium",
        "school_type": "Regional",
    },
    {
        "school": "George Brown College",
        "country": "Canada",
        "enabled": False,
        "url": "https://www.georgebrown.ca/international/tuition-and-scholarships",
        "urls": [
            "https://www.georgebrown.ca/international/tuition-and-scholarships",
            "https://www.georgebrown.ca/international/how-to-apply/scholarships",
            "https://www.georgebrown.ca/current-students/financial-aid",
        ],
        "priority": "high",
        "school_type": "International",
    },
    {
        "school": "North Carolina A&T State University",
        "country": "US",
        "enabled": True,
        "url": "https://www.ncat.edu/admissions/financial-aid/",
        "urls": [
            "https://www.ncat.edu/admissions/financial-aid/",
            "https://www.ncat.edu/admissions/financial-aid/scholarships/",
            "https://www.ncat.edu/",
        ],
        "priority": "high",
        "school_type": "HBCU",
    },
    {
        "school": "Florida A&M University",
        "country": "US",
        "enabled": True,
        "url": "https://www.famu.edu/",
        "urls": [
            "https://www.famu.edu/",
            "https://www.famu.edu/students/financial-aid/",
            "https://www.famu.edu/students/financial-aid/scholarships/index.php",
        ],
        "priority": "high",
        "school_type": "HBCU",
    },
    {
        "school": "Texas Southern University",
        "country": "US",
        "enabled": True,
        "url": "https://www.tsu.edu/academics/colleges-and-schools/",
        "urls": [
            "https://www.tsu.edu/academics/colleges-and-schools/",
            "https://www.tsu.edu/",
            "https://www.tsu.edu/financial-aid/scholarships/",
        ],
        "priority": "high",
        "school_type": "HBCU",
    },
    {
        "school": "Wentworth Institute of Technology",
        "country": "US",
        "enabled": True,
        "url": "https://wit.edu/admissions",
        "urls": [
            "https://wit.edu/admissions",
            "https://wit.edu/admissions/tuition-financial-aid/scholarships",
            "https://wit.edu/tuition-financial-aid",
        ],
        "priority": "medium",
        "school_type": "Technology",
    },
]

PUBLIC_SOURCE_CATALOG = [
    {
        "school": "Scholarships.com Directory",
        "country": "US",
        "enabled": True,
        "url": "https://www.scholarships.com/financial-aid/college-scholarships/scholarship-directory/",
        "urls": [
            "https://www.scholarships.com/financial-aid/college-scholarships/scholarship-directory/",
        ],
        "priority": "high",
        "school_type": "Public",
    },
    {
        "school": "Fastweb Scholarships",
        "country": "US",
        "enabled": True,
        "url": "https://www.fastweb.com/college-scholarships",
        "urls": ["https://www.fastweb.com/college-scholarships"],
        "priority": "high",
        "school_type": "Public",
    },
    {
        "school": "Bold.org Scholarships",
        "country": "US",
        "enabled": True,
        "url": "https://bold.org/scholarships/",
        "urls": ["https://bold.org/scholarships/"],
        "priority": "high",
        "school_type": "Public",
    },
    {
        "school": "Unigo Scholarships",
        "country": "US",
        "enabled": True,
        "url": "https://www.unigo.com/scholarships",
        "urls": ["https://www.unigo.com/scholarships"],
        "priority": "high",
        "school_type": "Public",
    },
    {
        "school": "Thurgood Marshall College Fund",
        "country": "US",
        "enabled": True,
        "url": "https://www.tmcf.org/students-alumni/scholarships/",
        "urls": [
            "https://www.tmcf.org/students-alumni/scholarships/",
        ],
        "priority": "high",
        "school_type": "Public",
    },
    {
        "school": "Jackie Robinson Foundation",
        "country": "US",
        "enabled": True,
        "url": "https://jackierobinson.org/apply/",
        "urls": [
            "https://jackierobinson.org/apply/",
            "https://jackierobinson.org/scholarship/",
        ],
        "priority": "high",
        "school_type": "Public",
    },
    {
        "school": "Delta Community Credit Union",
        "country": "US",
        "enabled": True,
        "url": "https://www.deltacommunitycu.com/community/scholarships.html",
        "urls": [
            "https://www.deltacommunitycu.com/community/scholarships/hbcu-scholarship.html",
            "https://www.deltacommunitycu.com/community/scholarships.html",
        ],
        "priority": "medium",
        "school_type": "Public",
    },
]

DEFAULT_AUTO_PULL_KEYWORDS = [
    "construction management",
    "building science",
    "merit scholarship",
    "departmental scholarship",
    "school nomination",
    "nomination deadline",
    "international entrance award",
    "early action",
    "international student",
    "tuition award",
    "leadership scholarship",
]

PUBLIC_SEARCH_CRITERIA = {
    "public_keywords": [
        "scholarship",
        "award",
        "grant",
        "fellowship",
        "funding",
        "open to all",
        "public scholarship",
        "national scholarship",
        "thurgood marshall",
        "jackie robinson",
        "delta community",
        "hbcu scholarship",
    ],
    "major_keywords": [
        "construction management",
        "construction",
        "building science",
        "civil engineering",
        "architecture",
        "project management",
        "engineering",
        "built environment",
        "skilled trades",
        "real estate",
    ],
    "audience_keywords": [
        "black",
        "african american",
        "black male",
        "men",
        "male",
        "young men",
        "diversity",
        "minority",
        "underrepresented",
        "bipoc",
    ],
    "countries": ["US", "Canada"],
    "target_major": "Construction Management",
    "target_profile": "Black male",
}

AUTO_PULL_COUNTRIES = ["US", "Canada"]

AUTO_PULL_CRITERIA = {
    "major": "Construction Management",
    "unweighted_gpa": 3.22,
    "target_intake": "Fall 2027",
    "countries": AUTO_PULL_COUNTRIES,
    "required_keywords": DEFAULT_AUTO_PULL_KEYWORDS,
}

PUBLIC_SEARCH_CRITERIA["minimum_gpa"] = 3.22
PUBLIC_SEARCH_CRITERIA["student_gpa"] = 3.22
AUTO_PULL_CRITERIA["minimum_gpa"] = 3.22
