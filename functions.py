import json
import re
from collections import defaultdict
import hashlib
import os
from datetime import datetime

def load_json(json_string):
    try:
        data = json.loads(json_string)
        return data
    except json.JSONDecodeError as e:
        print(f"JSON decoding error: {e}")
        return None

def parse_timestamp(timestamp):
    time_formats = [
        "%Y-%m-%d %H:%M:%S.%f%z",
        "%Y-%m-%d %H:%M:%S%z"
    ]
    for time_format in time_formats:
        try:
            return datetime.strptime(timestamp, time_format)
        except ValueError:
            continue
    raise ValueError(f"Time data {timestamp} does not match any known formats")


def calculate_time_difference(timestamp1, timestamp2):
    # Convert string timestamps to datetime objects
    time1 = parse_timestamp(timestamp1)
    time2 = parse_timestamp(timestamp2)
    
    # Calculate the difference
    time_difference = abs(time1 - time2)
    
    # Convert the timedelta to a dictionary with total seconds and human-readable format
    time_difference_dict = {
        'seconds': time_difference.total_seconds(),
        'readable': str(time_difference)
    }
    return time_difference_dict


def sort_cal_dict(dc):
    sorted_dc = {}
    for key, value in dc.items():
        sorted_dc[key] = len(set(value))
    sorted_dc = dict(sorted(sorted_dc.items(), key=lambda item: item[1], reverse=True))
    return sorted_dc
    

def get_sha256_hash(input_string):
    # Create a sha256 hash object
    hash_object = hashlib.sha256()
    
    # Update the hash object with the bytes of the input string
    hash_object.update(input_string.encode('utf-8'))
    
    # Get the hexadecimal representation of the hash
    hashed_string = hash_object.hexdigest()
    
    return hashed_string

def extract_letters(input_string):
    # Use a regular expression to find all alphabetic characters
    letters_only = re.findall(r'[a-zA-Z]+', input_string)
    # Join all the extracted letters into a single string
    return ''.join(letters_only)

def def_value(self):
    return 0

def def_ls(self):
    return []

def def_dc(self):
    return {}

def filter_dict_by_value(data, threshold):
    """
    Returns:
        dict: A filtered dictionary with values greater than or equal to the threshold.
    """
    return {key: value for key, value in data.items() if value >= threshold}


def write_json(file, data):
    f = open(file, 'a')
    f.write(json.dumps(data)+'\n')
    
def write_json_indent(file, data):
    with open(file, 'a') as f:
        f.write(json.dumps(data, indent=4) + '\n')

def write_new_json(file, data):
    with open(file, 'w') as f:
        for key, value in data.items():
            json_string = json.dumps({key: value})
            f.write(json_string + '\n')

def write_new_json_indent(file, data):
    with open(file, 'w') as f:
        for key, value in data.items():
            json_string = json.dumps({key: value}, indent=4)
            f.write(json_string + '\n')

def def_value():
    return 0

def def_ls():
    return []

def compare_dicts(dict1, dict2):
    """
    Compares two dictionaries and returns a dictionary with the differences.
    """
    # Keys added or removed
    keys_added = dict2.keys() - dict1.keys()
    keys_removed = dict1.keys() - dict2.keys()

    # Common keys with different values
    common_keys = dict1.keys() & dict2.keys()
    # Check if there are no differences
    modified = {key: (dict1[key], dict2[key]) for key in common_keys if dict1[key] != dict2[key]}
    if not keys_added and not keys_removed and not modified:
        return None
    return {
        'added': {key: dict2[key] for key in keys_added},
        'removed': {key: dict1[key] for key in keys_removed},
        'modified': modified
    }

def compare_dicts_modified(dict1, dict2):
    """
    Compares two dictionaries and returns a dictionary with the differences.
    """
    # Common keys with different values
    common_keys = dict1.keys() & dict2.keys()
    # Check if there are no differences
    modified = {key: (dict1[key], dict2[key]) for key in common_keys if dict1[key] != dict2[key]}
    if not modified:
        return None
    return modified

def extract_number(str):
    res = re.search(r'[\d._]*\d+', str)
    if res:
        # we only need digits for comparison
        res = res.group(0).replace('.', '').replace('_', '')
    return res if res else 0
    
def extract_number_ls(str):
    res = re.findall(r'[\d._]*\d+', str) 
    return res if res else [0]

def compare_number(num1, num2):
    res = []
    val1 = 0
    val2 = 0
    if num1:
        val1 = int(str(num1).replace('.', '').replace('_', ''))
    if num2:
        val2 = int(str(num2).replace('.', '').replace('_', ''))
    if val1 and val2:
        if val1 < val2:
            res.append('s')
        elif val1 == val2:
            res.append('e')
        else:
            res.append('l')
    return res

def compare_number_ls(num1, num2):
    res = []
    for i in range(min(len(num1), len(num2))):
        val1 = int(str(num1[i]).replace('.', '').replace('_', ''))
        val2 = int(str(num2[i]).replace('.', '').replace('_', ''))
        if val1 < val2:
            res.append('s')
        elif val1 == val2:
            res.append('e')
        else:
            res.append('l')
    return list(set(res))

def compare_ls(list1, list2):
    # Convert sublists to tuples to make them hashable
    list1 = [tuple(item) if isinstance(item, list) else item for item in list1]
    list2 = [tuple(item) if isinstance(item, list) else item for item in list2]
    
    # Use Counter to compare counts of elements in both lists
    count1 = Counter(list1)
    count2 = Counter(list2)
    
    unique_to_list1 = (count1 - count2)
    unique_to_list2 = (count2 - count1)
    
    # Convert back tuples to lists
    def convert_back(counter_obj):
        result = []
        for item, count in counter_obj.items():
            if isinstance(item, tuple):
                item = list(item)
            result.extend([item] * count)
        return result
    if unique_to_list1 or unique_to_list2:
        print("unique_to_list1", convert_back(unique_to_list1),
        "unique_to_list2", convert_back(unique_to_list2))

def remove_hexid_webgl_renderer(text):
    pattern = r'\s*\((0x[0-9A-Fa-f]+)\)\s*'
    modified_text = re.sub(pattern, ' ', text)
    return modified_text

def get_unstable_pairs():
    change_fp = defaultdict(dict)
    change_dir = 'pairs/'
    seen_files = set()  # Track seen files to debug duplicates
    fp_keys = ['userAgent', 'http_userAgent', 'appVersion', 'font', 'webgl_vendor', 'webgl_renderer', 'platform', 'buildID', 'productSub', 'navigator_vendor', 'colorDepth', 'pixelDepth', 'http_device', 'http_system_family', 'http_system', 'system', 'http_browser_family', 'system_family', 'browser_family', 'device', 'pluginFeature', 'dateFeature', 'devicePixelRatio', 'resolution', 'avail_resolution', 'webgl_parameters', 'canvas', 'platform_system_family', 'browser_family_system_family', 'userAgent_letter', 'appVersion_letter', 'http_userAgent_letter', 'http_browser_letter', 'browser_letter', 'http_system_letter', 'system_letter']
    for filename in os.listdir(change_dir):
        if filename in seen_files:
            print(f"Skipping duplicate: {filename}")
            continue
        seen_files.add(filename)
        attr = filename.replace('.json', '')
        if attr not in fp_keys:
            continue
        print('Getting pairs for:', attr)  # Debug print to see each file processed
        with open(os.path.join(change_dir, filename), 'r') as f:
            for line in f:
                data = json.loads(line)
                for each_key, each_val in data.items():
                    if attr == 'font' and '2e9e01ca' in each_key:
                        continue
                    change_fp[attr][each_key] = each_val

            if not change_fp[attr]:
                print(f"No data collected for attribute: {attr}")

    filtered_change_fp = {}
    for attr, attr_value in change_fp.items():
        filtered_change_fp[attr] = filter_dict_by_value(attr_value, 1)
    return filtered_change_fp

def get_nth_subfolder(directory, n):
    # Check if the specified directory exists
    if not os.path.exists(directory):
        return "Directory does not exist"
    # Get all entries in the directory that are directories themselves
    subfolders = [f.path for f in os.scandir(directory) if f.is_dir()]
    # Check if there are enough subfolders
    if len(subfolders) < n:
        return f"Less than {n} subfolders available"
    # Return the nth subfolder
    return subfolders[n - 1]+'/'  # Adjust for zero-based index

